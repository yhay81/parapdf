/** Compact the published JavaScript while keeping each module and its original TypeScript map. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
for (const path of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
  if (!path.endsWith(".js")) continue;
  const js = join(dist, path);
  const name = basename(js);
  const result = await minify(
    { [name]: readFileSync(js, "utf8") },
    {
      module: true,
      compress: false,
      mangle: { keep_classnames: true, keep_fnames: true },
      format: { comments: "some", preserve_annotations: true, quote_style: 2 },
      sourceMap: { content: readFileSync(`${js}.map`, "utf8"), filename: name, url: `${name}.map` },
    },
  );
  if (result.code === undefined || typeof result.map !== "string") throw new Error(path);
  writeFileSync(js, result.code);
  writeFileSync(`${js}.map`, result.map);
}
