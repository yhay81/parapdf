import { inflateSync } from "node:zlib";

/** Decodes a PNG screenshot into RGBA pixels: 8-bit, non-interlaced, as Playwright writes them. */
export function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : 4;
    } else if (type === "IDAT") data.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predicted = a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      line[x] = (value + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        out[(y * width + x) * 4 + c] = c < channels ? (line[x * channels + c] ?? 0) : 255;
      }
    }
    previous.set(line);
  }
  return { width, height, rgba: out };
}
