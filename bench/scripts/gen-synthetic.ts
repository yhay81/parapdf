/**
 * Writes deterministic stress documents to bench/corpus/generated/.
 * Usage: pnpm --filter @parapdf/bench corpus
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFRef,
  PDFString,
  rgb,
  StandardFonts,
} from "pdf-lib";

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

/**
 * Pages of different sizes and orientations, as office documents and drawing
 * sets mix them: A4 and Letter portrait, an A3 landscape sheet, an A5 page,
 * and an A4 page that /Rotate 90 shows landscape.
 */
async function mixedSizes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages: { size: [number, number]; rotate?: number; label: string }[] = [
    { size: [595, 842], label: "A4 portrait" },
    { size: [595, 842], label: "A4 portrait" },
    { size: [1191, 842], label: "A3 landscape" },
    { size: [595, 842], label: "A4 portrait" },
    { size: [595, 842], rotate: 90, label: "A4 shown landscape by /Rotate 90" },
    { size: [612, 792], label: "US Letter portrait" },
    { size: [420, 595], label: "A5 portrait" },
    { size: [595, 842], label: "A4 portrait" },
  ];
  pages.forEach(({ size: [width, height], rotate, label }, index) => {
    const page = doc.addPage([width, height]);
    if (rotate) page.setRotation(degrees(rotate));
    page.drawRectangle({
      x: 24,
      y: 24,
      width: width - 48,
      height: height - 48,
      borderWidth: 2,
      borderColor: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(`Page ${index + 1}: ${label}`, { x: 48, y: height - 72, size: 18, font });
    page.drawText(`Mixed sizes marker ${index + 1}`, { x: 48, y: height - 104, size: 12, font });
  });
  return doc.save();
}

/** Fixed dates, so that every run writes identical bytes. */
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

/**
 * Six pages with what a document viewer shows besides its pages: page
 * labels (i, ii, 1–4), an embedded file, two layers (optional content), one
 * of them hidden at first, a comment (a text annotation with a popup), form
 * fields of every common kind, and text for search options.
 */
async function features(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("ParaPDF feature sampler");
  doc.setAuthor("ParaPDF");
  doc.setSubject("Synthetic test document");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setLanguage("en");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const context = doc.context;
  const pages = Array.from({ length: 6 }, (_, index) => {
    const page = doc.addPage([612, 792]);
    page.drawText(`Feature sampler page ${index + 1}`, { x: 72, y: 720, size: 20, font });
    return page;
  });
  const [first, second] = pages as [(typeof pages)[0], (typeof pages)[0]];
  first.drawText("Rose rose ROSE resume résumé cat concatenate cat-like", {
    x: 72,
    y: 680,
    size: 14,
    font,
  });
  first.drawText("Layer A shows a red square; Layer B, hidden at first, a blue one.", {
    x: 72,
    y: 650,
    size: 12,
    font,
  });

  // Page labels: i, ii, then 1, 2, 3, 4.
  doc.catalog.set(PDFName.of("PageLabels"), context.obj({ Nums: [0, { S: "r" }, 2, { S: "D" }] }));

  // An embedded file.
  await doc.attach(new TextEncoder().encode("Notes embedded in the sampler.\n"), "notes.txt", {
    mimeType: "text/plain",
    description: "Sampler notes",
    creationDate: FIXED_DATE,
    modificationDate: FIXED_DATE,
  });

  // Two layers: A on, B off, each drawing a square on page 1.
  const layerA = context.register(context.obj({ Type: "OCG", Name: PDFString.of("Layer A") }));
  const layerB = context.register(context.obj({ Type: "OCG", Name: PDFString.of("Layer B") }));
  doc.catalog.set(
    PDFName.of("OCProperties"),
    context.obj({
      OCGs: [layerA, layerB],
      D: { Order: [layerA, layerB], ON: [layerA], OFF: [layerB] },
    }),
  );
  const resources = first.node.Resources() ?? context.obj({});
  resources.set(PDFName.of("Properties"), context.obj({ LA: layerA, LB: layerB }));
  first.node.set(PDFName.of("Resources"), resources);
  first.node.addContentStream(
    context.register(
      context.flateStream(
        [
          "/OC /LA BDC 1 0 0 rg 72 480 120 120 re f EMC",
          "/OC /LB BDC 0 0 1 rg 240 480 120 120 re f EMC",
        ].join("\n"),
      ),
    ),
  );

  // A comment: a sticky note whose popup holds its text.
  const note = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [420, 560, 444, 584],
      Contents: PDFString.of("A comment on the sampler"),
      T: PDFString.of("Reviewer"),
      Name: "Comment",
      Open: false,
    }),
  );
  first.node.set(PDFName.of("Annots"), context.obj([note]));

  // Form fields on page 2.
  const form = doc.getForm();
  second.drawText("Name", { x: 72, y: 652, size: 12, font });
  form.createTextField("name").addToPage(second, { x: 140, y: 640, width: 240, height: 24, font });
  second.drawText("Agree", { x: 72, y: 600, size: 12, font });
  form.createCheckBox("agree").addToPage(second, { x: 140, y: 594, width: 18, height: 18 });
  const choice = form.createRadioGroup("color");
  for (const [index, option] of ["red", "green"].entries()) {
    second.drawText(option, { x: 168 + index * 80, y: 552, size: 12, font });
    choice.addOptionToPage(option, second, { x: 140 + index * 80, y: 548, width: 18, height: 18 });
  }
  const size = form.createDropdown("size");
  size.addOptions(["small", "medium", "large"]);
  size.addToPage(second, { x: 140, y: 500, width: 120, height: 24, font });
  form.updateFieldAppearances(font);
  return doc.save({ useObjectStreams: false });
}

/** RC4, which PDF's standard security handler revision 2 encrypts with. */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + (state[i] ?? 0)) & 0xff;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
    out[n] = (data[n] ?? 0) ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) & 0xff] ?? 0);
  }
  return out;
}

const md5 = (...parts: Uint8Array[]): Uint8Array => {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};

/** The 32-byte padding of PDF 32000-1, 7.6.3.3, Algorithm 2. */
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const padPassword = (password: string): Uint8Array => {
  const bytes = new TextEncoder().encode(password).slice(0, 32);
  const padded = new Uint8Array(32);
  padded.set(bytes);
  padded.set(PASSWORD_PADDING.subarray(0, 32 - bytes.length), bytes.length);
  return padded;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/**
 * The feature sampler's text pages encrypted with the user password
 * "parapdf", by the standard security handler, revision 2 (40-bit RC4): the
 * oldest scheme, which is short to write here and which pdf.js asks the
 * password for like every other.
 */
async function encrypted(): Promise<Uint8Array> {
  const plain = await PDFDocument.create({ updateMetadata: false });
  const font = await plain.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 3; index++) {
    const page = plain.addPage([612, 792]);
    page.drawText(`Encrypted page ${index + 1}`, { x: 72, y: 720, size: 20, font });
  }
  plain.setTitle("Encrypted sampler");
  const doc = await PDFDocument.load(await plain.save({ useObjectStreams: false }), {
    updateMetadata: false,
  });
  const context = doc.context;
  const id = md5(new TextEncoder().encode("parapdf encrypted sampler"));
  const permissions = -44;
  const owner = rc4(md5(padPassword("parapdf-owner")).subarray(0, 5), padPassword("parapdf"));
  const permissionBytes = new Uint8Array(4);
  new DataView(permissionBytes.buffer).setInt32(0, permissions, true);
  const key = md5(padPassword("parapdf"), owner, permissionBytes, id).subarray(0, 5);
  const user = rc4(key, PASSWORD_PADDING);
  const objectKey = (ref: PDFRef) =>
    md5(
      key,
      Uint8Array.from([
        ref.objectNumber & 0xff,
        (ref.objectNumber >> 8) & 0xff,
        (ref.objectNumber >> 16) & 0xff,
        ref.generationNumber & 0xff,
        (ref.generationNumber >> 8) & 0xff,
      ]),
    ).subarray(0, 10);
  // Strings, nested anywhere in an object, become encrypted hex strings.
  const encryptStrings = (value: unknown, keyBytes: Uint8Array): unknown => {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      return PDFHexString.of(hex(rc4(keyBytes, value.asBytes())));
    }
    if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index++) {
        value.set(index, encryptStrings(value.get(index), keyBytes) as never);
      }
    } else if (value instanceof PDFDict) {
      for (const [name, entry] of value.entries()) {
        value.set(name, encryptStrings(entry, keyBytes) as never);
      }
    }
    return value;
  };
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    const keyBytes = objectKey(ref);
    if (object instanceof PDFRawStream) {
      encryptStrings(object.dict, keyBytes);
      context.assign(ref, PDFRawStream.of(object.dict, rc4(keyBytes, object.contents)));
    } else {
      encryptStrings(object, keyBytes);
    }
  }
  const encrypt = context.register(
    context.obj({
      Filter: "Standard",
      V: 1,
      R: 2,
      O: PDFHexString.of(hex(owner)),
      U: PDFHexString.of(hex(user)),
      P: PDFNumber.of(permissions),
    }),
  );
  context.trailerInfo.Encrypt = encrypt;
  context.trailerInfo.ID = context.obj([PDFHexString.of(hex(id)), PDFHexString.of(hex(id))]);
  return doc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

mkdirSync(outDir, { recursive: true });
for (const [name, build] of [
  ["synthetic-text-1000.pdf", longText],
  ["synthetic-vector-200k.pdf", vectorHeavy],
  ["synthetic-cjk-nonembedded.pdf", cjkNonEmbedded],
  ["synthetic-mixed-sizes.pdf", mixedSizes],
  ["synthetic-features.pdf", features],
  ["synthetic-encrypted.pdf", encrypted],
] as const) {
  const bytes = await build();
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}: ${(bytes.byteLength / 1024).toFixed(0)} KiB`);
}
