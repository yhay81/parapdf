/**
 * Writes deterministic stress documents to bench/corpus/generated/.
 * Usage: pnpm --filter @parapdf/bench corpus
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

const outDir = fileURLToPath(new URL("../corpus/generated/", import.meta.url));

/** mulberry32: a tiny seeded PRNG so every run writes identical bytes. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function longText(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const words =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(
      " ",
    );
  const next = seeded(1);
  for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${pageIndex + 1}`, { x: 72, y: 740, size: 18, font });
    for (let line = 0; line < 52; line++) {
      const text = Array.from({ length: 12 }, () => words[Math.floor(next() * words.length)]).join(
        " ",
      );
      page.drawText(text, { x: 72, y: 710 - line * 12.5, size: 10, font });
    }
  }
  return doc.save({ useObjectStreams: true });
}

async function vectorHeavy(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [width, height] = [842, 1191];
  const page = doc.addPage([width, height]);
  const next = seeded(2);
  const ops: string[] = ["0.3 w 1 J 1 j"];
  for (let segments = 0; segments < 200_000; segments += 100) {
    ops.push(
      `${(next() * 0.6).toFixed(3)} ${(next() * 0.6).toFixed(3)} ${(next() * 0.6).toFixed(3)} RG`,
    );
    let x = next() * width;
    let y = next() * height;
    ops.push(`${x.toFixed(2)} ${y.toFixed(2)} m`);
    for (let step = 0; step < 100; step++) {
      x = clamp(x + (next() - 0.5) * 12, 0, width);
      y = clamp(y + (next() - 0.5) * 12, 0, height);
      ops.push(`${x.toFixed(2)} ${y.toFixed(2)} l`);
    }
    ops.push("S");
  }
  page.node.addContentStream(doc.context.register(doc.context.flateStream(ops.join("\n"))));
  return doc.save();
}

/** UCS-2 big-endian hex for UniJIS-UCS2 encodings (BMP text only). */
function ucs2Hex(text: string): string {
  return Array.from(text, (char) => (char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")).join(
    "",
  );
}

async function cjkNonEmbedded(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const context = doc.context;
  const descriptor = context.register(
    context.obj({
      Type: "FontDescriptor",
      FontName: "MS-Mincho",
      Flags: 6,
      FontBBox: [0, -141, 1000, 859],
      ItalicAngle: 0,
      Ascent: 859,
      Descent: -141,
      CapHeight: 709,
      StemV: 78,
    }),
  );
  const cidFont = context.register(
    context.obj({
      Type: "Font",
      Subtype: "CIDFontType0",
      BaseFont: "MS-Mincho",
      CIDSystemInfo: {
        Registry: PDFString.of("Adobe"),
        Ordering: PDFString.of("Japan1"),
        Supplement: 6,
      },
      FontDescriptor: descriptor,
      DW: 1000,
    }),
  );
  for (const [name, encoding] of [
    ["F1", "UniJIS-UCS2-H"],
    ["F2", "UniJIS-UCS2-V"],
  ] as const) {
    const font = context.register(
      context.obj({
        Type: "Font",
        Subtype: "Type0",
        BaseFont: "MS-Mincho",
        Encoding: encoding,
        DescendantFonts: [cidFont],
      }),
    );
    page.node.setFontDictionary(PDFName.of(name), font);
  }
  const horizontal = [
    "日本語の非埋め込みフォントの表示テストです。",
    "古い文書では明朝体やゴシック体が埋め込まれていないことがあります。",
    "ビューアは CMap と代替フォントで文字を描く必要があります。",
    "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。",
  ];
  const ops = ["BT", "/F1 16 Tf", "22 TL", "56 780 Td"];
  for (let repeat = 0; repeat < 6; repeat++) {
    for (const line of horizontal) ops.push(`<${ucs2Hex(line)}> Tj T*`);
  }
  ops.push(
    "ET",
    "BT",
    "/F2 18 Tf",
    "540 560 Td",
    `<${ucs2Hex("縦書きの非埋め込みフォント")}> Tj`,
    "ET",
  );
  page.node.addContentStream(context.register(context.flateStream(ops.join("\n"))));
  return doc.save();
}

mkdirSync(outDir, { recursive: true });
for (const [name, build] of [
  ["synthetic-text-1000.pdf", longText],
  ["synthetic-vector-200k.pdf", vectorHeavy],
  ["synthetic-cjk-nonembedded.pdf", cjkNonEmbedded],
] as const) {
  const bytes = await build();
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}: ${(bytes.byteLength / 1024).toFixed(0)} KiB`);
}
