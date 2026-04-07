import { deflateSync } from 'zlib';
import { PngImageTemplateMatcher } from './png-image-template-matcher';

describe('PngImageTemplateMatcher', () => {
  it('matches the best candidate region by template pixels', async () => {
    const matcher = new PngImageTemplateMatcher();
    const template = encodePng(2, 2, [
      [0, 0, 0, 255], [255, 255, 255, 255],
      [255, 255, 255, 255], [0, 0, 0, 255],
    ]);
    const screenshot = encodePng(6, 4, [
      [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
      [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
      [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255],
      [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
    ]);

    const result = await matcher.matchTargetOnScreenshot(screenshot, {
      kind: 'image',
      value: 'submit-template.png',
      imageUrl: 'data:image/png;base64,' + template.toString('base64'),
      confidenceThreshold: 0.8,
    }, [
      {
        ref: 'e1',
        role: 'button',
        bounds: { x: 1, y: 1, width: 2, height: 2 },
      },
      {
        ref: 'e2',
        role: 'button',
        bounds: { x: 3, y: 1, width: 2, height: 2 },
      },
    ]);

    expect(result.matched).toBe(true);
    expect(result.element?.ref).toBe('e1');
    expect(result.score).toBeGreaterThan(0.9);
  });
});

function encodePng(width: number, height: number, pixels: number[][]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rawRows.push(0);
    for (let x = 0; x < width; x += 1) {
      rawRows.push(...pixels[y * width + x]);
    }
  }

  const idat = deflateSync(Buffer.from(rawRows));
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  return Buffer.concat([header, data, crc]);
}
