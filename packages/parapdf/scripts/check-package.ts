/**
 * Checks the package as npm would install it: packs it, unpacks the tarball
 * into a temporary project next to this workspace's React, React DOM, and
 * pdf.js, and then checks the files it ships, pdf.js's files among them, the
 * manifest, the "use client" directives, that TypeScript resolves and accepts
 * its declarations under the bundler and nodenext module resolutions, and
 * that its components render on the server. Exits non-zero on failure.
 * Usage: node scripts/check-package.ts
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(packageDir, "package.json"));
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const project = mkdtempSync(join(tmpdir(), "parapdf-package-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", project], {
    cwd: packageDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(project).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack wrote no tarball");
  const installed = join(project, "node_modules", "parapdf");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", join(project, tarball), "-C", installed, "--strip-components=1"]);

  // The files the package ships.
  const files = execFileSync("tar", ["-tzf", join(project, tarball)], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((name) => name.replace(/^package\//, ""));
  const required = [
    "README.md",
    "LICENSE",
    "NOTICE.md",
    "LICENSES/pdf.js-Apache-2.0.txt",
    "dist/index.js",
    "dist/index.d.ts",
    "pdfjs/LICENSE",
    "pdfjs/pdf.worker.js",
    "pdfjs/standard_fonts/LICENSE_FOXIT",
    "pdfjs/standard_fonts/LICENSE_LIBERATION",
  ];
  const missing = required.filter((name) => !files.includes(name));
  check(
    "the tarball holds the code, declarations, readme, and notices",
    missing.length === 0,
    missing.join(", "),
  );
  const stray = files.filter(
    (name) => /(^|\/)(test|scripts)\//.test(name) || name.endsWith(".tgz"),
  );
  check("the tarball holds no tests, scripts, or tarballs", stray.length === 0, stray.join(", "));

  // Every file the code references with new URL(…, import.meta.url) ships.
  const references = ["pdfjs-files.js", "pdfjs-legacy-files.js"].flatMap((module) =>
    [
      ...readFileSync(join(installed, "dist/engine", module), "utf8").matchAll(
        /new URL\(\s*"\.\.\/\.\.\/(pdfjs\/[^"]+)"/g,
      ),
    ].map((match) => match[1] ?? ""),
  );
  const unshipped = references.filter((name) => !files.includes(name));
  check(
    "the tarball holds every pdf.js file the code references",
    references.length > 150 && unshipped.length === 0,
    `${references.length} references; ${unshipped.slice(0, 3).join(", ")}`,
  );

  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const exported = manifest.exports?.["."];
  check(
    "the manifest is public and exports the built files",
    manifest.private === undefined &&
      exported?.types === "./dist/index.d.ts" &&
      exported?.default === "./dist/index.js" &&
      manifest.types === "./dist/index.d.ts",
    JSON.stringify({ private: manifest.private, exports: manifest.exports, types: manifest.types }),
  );

  // The shipped worker and decoders must be the pdf.js the code imports.
  const shippedVersion = /from pdfjs-dist (\S+);/.exec(
    readFileSync(join(installed, "src/engine/pdfjs-files.ts"), "utf8"),
  )?.[1];
  check(
    "the manifest depends on exactly the pdf.js whose files ship",
    manifest.dependencies?.["pdfjs-dist"] === shippedVersion &&
      manifest.peerDependencies?.["pdfjs-dist"] === undefined,
    JSON.stringify({ dependencies: manifest.dependencies, shippedVersion }),
  );

  // The styles and the editor's icons are strings, which server and client share.
  const dataModules = new Set(["styles.js", "editor-styles.js", "editor-icons.js"]);
  const clientModules = readdirSync(join(installed, "dist", "react")).filter(
    (name) => name.endsWith(".js") && !dataModules.has(name),
  );
  const withoutDirective = clientModules.filter(
    (name) =>
      !readFileSync(join(installed, "dist", "react", name), "utf8").startsWith('"use client";'),
  );
  check(
    'every React module starts with "use client"',
    clientModules.length > 0 && withoutDirective.length === 0,
    withoutDirective.join(", "),
  );

  // The peers and the dependency, as the application would install them.
  for (const name of ["react", "react-dom", "pdfjs-dist", "@types/react", "@types/react-dom"]) {
    const target = join(project, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(dirname(require.resolve(`${name}/package.json`)), target, "dir");
  }
  writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module", private: true }));

  // An application's use of the API, type-checked against the declarations.
  writeFileSync(
    join(project, "consumer.tsx"),
    `import {
  configurePdfjs,
  PdfDocument,
  PdfPageRect,
  PdfViewport,
  preloadPdfjs,
  usePdfDocument,
  usePdfSearch,
  usePdfState,
  usePdfViewer,
  type ViewerOptions,
} from "parapdf";

configurePdfjs({ enableHWA: true, documentOptions: { withCredentials: true } });
preloadPdfjs();
const options: ViewerOptions = { initialScale: "fit-width", maxCanvasPixels: 50_000_000 };

export function Viewer() {
  return (
    <PdfDocument source="/manual.pdf" options={options}>
      <Toolbar />
      <PdfViewport
        style={{ height: 600 }}
        pageLabel={(pageNumber, pageCount) => \`\${pageNumber} / \${pageCount}\`}
        renderOverlay={(pageIndex) =>
          pageIndex === 0 ? <PdfPageRect pageIndex={0} x={72} y={72} width={100} height={20} /> : null
        }
      />
    </PdfDocument>
  );
}

function Toolbar() {
  const viewer = usePdfViewer();
  const search = usePdfSearch();
  const page: number = usePdfState((state) => state.currentPage);
  const pages: number | undefined = usePdfDocument()?.numPages;
  return (
    <button type="button" onClick={() => { viewer.setScale("fit-width"); search.search("pdf"); }}>
      {page + 1} / {pages}
    </button>
  );
}
`,
  );
  // A misuse that the declarations must reject, so a passing check means
  // TypeScript did check the application against them.
  writeFileSync(
    join(project, "misuse.tsx"),
    `import { PdfViewport } from "parapdf";

export const misuse = <PdfViewport pageLabel={5} />;
`,
  );
  const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  for (const resolution of ["bundler", "nodenext"]) {
    const config = join(project, `tsconfig.${resolution}.json`);
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          jsx: "react-jsx",
          target: "es2023",
          lib: ["es2023", "dom", "dom.iterable"],
          module: resolution === "bundler" ? "esnext" : "nodenext",
          moduleResolution: resolution,
          types: [],
        },
        files: ["consumer.tsx", "misuse.tsx"],
      }),
    );
    let output = "";
    try {
      execFileSync(process.execPath, [tsc, "-p", config], { cwd: project, encoding: "utf8" });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error);
    }
    // Errors inside the peers' own declarations are theirs.
    const lines = output.split("\n");
    const ours = lines.filter((line) => /consumer\.tsx|node_modules\/parapdf\//.test(line));
    const rejected = lines.some((line) => /misuse\.tsx/.test(line));
    check(
      `TypeScript checks an application against the declarations with ${resolution} resolution`,
      ours.length === 0 && rejected,
      rejected
        ? ours.slice(0, 3).join(" | ")
        : "the misuse passed: the declarations were not checked",
    );
  }

  // The components render on the server, for frameworks that prerender
  // client components; pdf.js only loads in the browser.
  writeFileSync(
    join(project, "ssr.js"),
    `import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PdfDocument, PdfViewport } from "parapdf";

process.stdout.write(
  renderToString(
    createElement(PdfDocument, { source: "/manual.pdf" }, createElement(PdfViewport, { label: "Manual" })),
  ),
);
`,
  );
  let html = "";
  try {
    html = execFileSync(process.execPath, ["ssr.js"], { cwd: project, encoding: "utf8" });
  } catch (error) {
    html = String(error);
  }
  const rendered = html.includes('role="document"') && html.includes('aria-label="Manual"');
  check("the components render on the server", rendered, rendered ? "" : html.slice(0, 200));
  check(
    "the server's page starts downloading the PDF",
    /<link rel="preload" href="\/manual\.pdf" as="fetch" crossorigin="(anonymous|)"\/>/.test(html),
    html.slice(0, 200),
  );
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
