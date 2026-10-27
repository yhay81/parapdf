/**
 * Writes variants of corpus/pdfium-smask-blend.pdf into dist/corpus/, each
 * with a rebuilt cross-reference table, so that fidelity.ts can tell which
 * of the fixture's features makes pdf.js draw it unlike PDFium
 * (bench/upstream/pdfjs-smask-group-issue.md). Run after `pnpm bench:build`,
 * which empties dist/.
 *
 * The fixture's soft mask (object 5) takes its values from a form (object 6)
 * without the /Group a soft mask's G requires; the page paints a form with
 * the Screen blend mode and 0.6 opacity under that soft mask.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(benchDir, "dist/corpus");
if (!existsSync(outDir)) throw new Error("dist/ is missing; run `pnpm bench:build` first.");

const source = readFileSync(join(benchDir, "corpus/pdfium-smask-blend.pdf"), "latin1");
const objects = [...source.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)].map(
  (match) => [Number(match[1]), match[2] ?? ""] as const,
);

type Edit = (object: number, body: string) => string;

function build(edit: Edit): string {
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const [object, body] of objects) {
    offsets[object] = out.length;
    out += `${object} 0 obj${edit(object, body)}endobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let object = 1; object <= objects.length; object++) {
    out += `${String(offsets[object]).padStart(10, "0")} 00000 n \n`;
  }
  return `${out}trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
}

const normal: Edit = (_, body) => body.replace("/BM /Screen", "");
const noMask: Edit = (_, body) => body.replace("/SMask 5 0 R", "");
const luminosity: Edit = (_, body) => body.replace("/S /Alpha", "/S /Luminosity");
const group: Edit = (object, body) =>
  object === 6
    ? body.replace("/Subtype /Form", "/Subtype /Form\n  /Group << /S /Transparency >>")
    : body;
const typed: Edit = (_, body) => body.replaceAll("/Type XObject", "/Type /XObject");
const both =
  (...edits: Edit[]): Edit =>
  (object, body) =>
    edits.reduce((result, edit) => edit(object, result), body);

const variants: Record<string, Edit> = {
  "smask-normal": normal,
  "smask-nomask": noMask,
  "smask-normal-nomask": both(normal, noMask),
  "smask-luminosity": luminosity,
  "smask-typed": typed,
  "smask-group": group,
  "smask-group-typed": both(group, typed),
  "smask-group-luminosity": both(group, luminosity),
};
for (const [name, edit] of Object.entries(variants)) {
  writeFileSync(join(outDir, `${name}.pdf`), build(edit), "latin1");
}
console.log(`Wrote ${Object.keys(variants).length} variants to ${outDir}`);
