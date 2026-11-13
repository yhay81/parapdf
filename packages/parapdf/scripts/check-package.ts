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
  const references = ["files.js", "legacy-files.js"].flatMap((module) =>
    [
      ...readFileSync(join(installed, "dist/pdfjs", module), "utf8").matchAll(
        /new URL\(\s*"\.\.\/\.\.\/(pdfjs\/[^"?]+)/g,
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
  check(
    "the manifest and shipped license identify Apache-2.0",
    manifest.license === "Apache-2.0" &&
      readFileSync(join(installed, "LICENSE"), "utf8").includes("Apache License\n") &&
      readFileSync(join(installed, "NOTICE.md"), "utf8").includes("Copyright Mozilla Foundation"),
  );
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
    readFileSync(join(installed, "src/pdfjs/files.ts"), "utf8"),
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
    `import { Suspense, useRef } from "react";
import {
  type AnnotationTool,
  configurePdfjs,
  type OutlineItemHelpers,
  PdfAnnotationEditor,
  PdfAutoLinks,
  PdfDocument,
  PdfForms,
  PdfOutline,
  PdfPageOverlay,
  PdfPageOverlays,
  type PdfPagePoint,
  PdfPageRect,
  PdfPermissions,
  PdfSelectionPopover,
  PdfThumbnails,
  PdfView,
  PdfViewer,
  type PdfViewerProps,
  preloadDocument,
  preloadPdfjs,
  type SelectionAnchor,
  type ThumbnailItem,
  useAnnotations,
  useCreateViewer,
  useDocumentState,
  useFormChange,
  useHistory,
  usePrint,
  useSave,
  useSearch,
  useSelection,
  useSession,
  useViewer,
  useViewState,
  setLayerVisible,
  type Viewer,
  type ViewState,
} from "parapdf";

configurePdfjs({ enableHWA: true, documentOptions: { withCredentials: true } });
preloadPdfjs();
preloadDocument("/manual.pdf");
const options: PdfViewerProps = { defaultZoom: "fit-width", maxCanvasPixels: 50_000_000 };

export function Reader() {
  const viewerRef = useRef<Viewer>(null);
  const rectRef = useRef<HTMLDivElement>(null);
  return (
    <PdfDocument source="/manual.pdf" onOpenAttachment={(file) => void file.filename}>
      <Toolbar />
      <PdfThumbnails>
        {(item: ThumbnailItem) => (
          <button type="button" aria-label={item.ariaLabel} onClick={item.select}>
            {item.thumbnail}
            <span>{item.label}</span>
          </button>
        )}
      </PdfThumbnails>
      <Suspense fallback={null}>
        <PdfOutline
          defaultExpanded={false}
          renderItem={(_node, helpers: OutlineItemHelpers) => (
            <>
              {helpers.link}
              {helpers.children}
            </>
          )}
        />
      </Suspense>
      <PdfViewer
        {...options}
        ref={viewerRef}
        style={{ height: 600 }}
        pageLabel={(pageNumber, pageCount) => \`\${pageNumber} / \${pageCount}\`}
        onPageClick={(point: PdfPagePoint, event) => {
          void point.pageIndex;
          void viewerRef.current?.pointAt(event);
        }}
        onViewStateChange={(view: ViewState) => {
          void view.page;
        }}
      >
        <PdfPageOverlay page={0}>
          <PdfPageRect ref={rectRef} x={72} y={72} width={100} height={20} />
        </PdfPageOverlay>
        <PdfPageOverlays>
          {(pageIndex) =>
            pageIndex === 1 ? <PdfPageRect x={36} y={36} width={80} height={16} /> : null
          }
        </PdfPageOverlays>
        <PdfSelectionPopover placement="top" offset={8}>
          {(selection) => {
            const anchor: SelectionAnchor = selection.anchor;
            void anchor.getBoundingClientRect();
            return <span>{selection.text}</span>;
          }}
        </PdfSelectionPopover>
        <PdfForms scripts onChange={(change) => void change.name} />
        <PdfAnnotationEditor
          defaultTool="none"
          labels={{ highlight: "Marker" }}
          onToolChange={(tool: AnnotationTool) => void tool}
        />
        <PdfAutoLinks />
        <PdfPermissions />
      </PdfViewer>
    </PdfDocument>
  );
}

export function SplitReader() {
  const external = useCreateViewer();
  return (
    <PdfDocument source="/manual.pdf">
      <PdfView>
        <Toolbar />
        <PdfViewer />
      </PdfView>
      <PdfView viewer={external}>
        <PdfViewer />
      </PdfView>
    </PdfDocument>
  );
}

function Toolbar() {
  const viewer = useViewer();
  const session = useSession();
  const search = useSearch();
  const history = useHistory();
  const { save, saving } = useSave();
  const { print, printing, progress, cancel } = usePrint();
  const annotations = useAnnotations();
  const { currentPage, pageCount } = useViewState();
  const slice = useViewState((state) => ({ page: state.currentPage, scale: state.scale }));
  const { status } = useDocumentState();
  const pages: number = useDocumentState((state) => state.pageCount);
  useFormChange(() => {});
    const selection = useSelection();
    void selection?.anchor;
  const proxy = session.proxy;
  const sessionStatus: string = session.state.status;
  const snapshotPage: number = viewer.state.currentPage;
  // @ts-expect-error Viewer hides internal store
  void viewer.store;
  // @ts-expect-error Viewer hides internal extend
  void viewer.extend;
  // @ts-expect-error Viewer hides internal renderer
  void viewer.renderer;
  // @ts-expect-error Viewer hides internal session
  void viewer.session;
  // @ts-expect-error PdfSession hides internal stateStore
  void session.stateStore;
  // @ts-expect-error PdfSession.state is a synchronous snapshot, not a store
  void session.state.get;
  // @ts-expect-error PdfSession.state is a synchronous snapshot, not a store
  void session.state.subscribe;
  // @ts-expect-error PdfSession removed duplicate promise methods
  void session.outline;
  // @ts-expect-error PdfSession removed duplicate promise methods
  void session.layers;
  return (
    <button
      type="button"
      onClick={() => {
        viewer.setScale("fit-width");
        const view = viewer.viewState();
        if (view) viewer.setViewState(view);
        setLayerVisible(session, "layer-1", true);
        search.search("pdf");
        history.back();
        void save();
        if (printing) cancel();
        else void print();
        void annotations.setTool("highlight");
      }}
    >
      {currentPage + 1} / {pageCount} ({snapshotPage}, {slice.scale}, {status}, {sessionStatus}, {pages}, {annotations.tool}, {String(saving)}, {progress?.done ?? 0}) {proxy?.numPages}
    </button>
  );
}
`,
  );
  // A misuse that the declarations must reject, so a passing check means
  // TypeScript did check the application against them.
  writeFileSync(
    join(project, "misuse.tsx"),
    `import { PdfViewer } from "parapdf";

export const misuse = <PdfViewer pageLabel={5} renderOverlay={() => null} />;
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
    `import { createElement, Suspense } from "react";
import { renderToString } from "react-dom/server";
import {
  PdfAnnotationEditor,
  PdfAutoLinks,
  PdfDocument,
  PdfForms,
  PdfOutline,
  PdfPageOverlay,
  PdfPageOverlays,
  PdfPageRect,
  PdfPermissions,
  PdfSelectionPopover,
  PdfThumbnails,
  PdfView,
  PdfViewer,
  preloadDocument,
  useAnnotations,
  useDocumentState,
  useHistory,
  usePrint,
  useSave,
  useSearch,
  useSelection,
  useViewer,
  useViewState,
} from "parapdf";
import * as parapdfExports from "parapdf";

for (const removed of [
  "searchOf",
  "attachSearch",
  "historyOf",
  "attachHistory",
  "attachThumbnail",
  "enforcePermissions",
  "useAnnotationEditing",
  "getSelection",
  "getViewState",
  "setViewState",
  "Viewer",
  "PdfSession",
  "ViewerExtension",
  "Opening",
]) {
  if (removed in parapdfExports) throw new Error(\`\${removed} is still exported\`);
}

let rectRejected = false;
try {
  renderToString(createElement(PdfPageRect, { x: 0, y: 0, width: 10, height: 10 }));
} catch (err) {
  rectRejected = /PdfPageOverlay/.test(String(err));
}
if (!rectRejected) throw new Error("PdfPageRect did not reject outside PageContext");

function Toolbar() {
  useViewer();
  useSearch();
  useHistory();
  useSelection();
  preloadDocument("/warm.pdf");
  const { saving } = useSave();
  const { printing } = usePrint();
  const { tool } = useAnnotations();
  const { currentPage, pageCount } = useViewState();
  const { status } = useDocumentState();
  return createElement("output", null, \`\${status}:\${currentPage}/\${pageCount}:\${tool}:\${saving}:\${printing}\`);
}

process.stdout.write(
  renderToString(
    createElement(
      PdfDocument,
      { source: "/manual.pdf" },
      createElement(Toolbar),
      createElement(PdfThumbnails),
      createElement(Suspense, { fallback: null }, createElement(PdfOutline)),
      createElement(
        PdfViewer,
        { label: "Manual", onPageClick: () => {} },
        createElement(PdfPageOverlay, { page: 0 }, createElement(PdfPageRect, { x: 0, y: 0, width: 10, height: 10 })),
        createElement(PdfPageOverlays, null, (i) => (i === 0 ? createElement("span", null, "p0") : null)),
        createElement(PdfSelectionPopover, null, (sel) => createElement("span", null, sel.text)),
        createElement(PdfForms, { scripts: true }),
        createElement(PdfAnnotationEditor, { defaultTool: "highlight" }),
        createElement(PdfAutoLinks),
        createElement(PdfPermissions),
      ),
      createElement(PdfView, null, createElement(Toolbar), createElement(PdfViewer, { label: "Secondary" })),
    ),
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
  const rendered =
    html.includes('role="document"') &&
    html.includes('aria-label="Manual"') &&
    html.includes('aria-label="Secondary"') &&
    html.includes('data-precedence="parapdf"') &&
    html.includes("<output>loading:0/0:none:false:false</output>");
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
