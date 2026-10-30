/**
 * Copies the repository's license and notices into this package before it
 * is packed, and removes the copies afterwards. The package must carry the
 * Apache-2.0 notice of the pdf.js code ParaPDF derives from (NOTICE.md).
 * Usage: node scripts/legal-files.ts copy|remove
 */
import { cpSync, rmSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const here = new URL("../", import.meta.url);
for (const name of ["LICENSE", "NOTICE.md"]) {
  const target = new URL(name, here);
  if (process.argv[2] === "remove") rmSync(target, { recursive: true, force: true });
  else cpSync(new URL(name, root), target, { recursive: true });
}
