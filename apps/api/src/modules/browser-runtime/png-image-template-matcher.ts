import { inflateSync } from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserSnapshotElement, RpaTargetDefinition } from '@uniflow/shared-types';

interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface PixelTemplateMatchResult {
  matched: boolean;
  score: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  element?: BrowserSnapshotElement;
}

export class PngImageTemplateMatcher {
  async matchTargetOnScreenshot(
    screenshot: Buffer,
    target: RpaTargetDefinition,
    candidates: BrowserSnapshotElement[],
  ): Promise<PixelTemplateMatchResult> {
    const templateBuffer = await this.loadTemplateBuffer(target);
    if (!templateBuffer) {
      return { matched: false, score: 0 };
    }

    const source = this.decodePng(screenshot);
    const template = this.decodePng(templateBuffer);
    const threshold = target.confidenceThreshold ?? 0.72;
    let best: PixelTemplateMatchResult = { matched: false, score: 0 };

    for (const element of candidates) {
      if (!element.bounds || element.bounds.width <= 0 || element.bounds.height <= 0) {
        continue;
      }

      const score = this.compareRegion(source, template, element.bounds);
      if (score > best.score) {
        best = {
          matched: score >= threshold,
          score,
          bounds: element.bounds,
          element,
        };
      }
    }

    return best;
  }

  private async loadTemplateBuffer(target: RpaTargetDefinition) {
    if (target.imageUrl?.startsWith('data:image/png;base64,')) {
      return Buffer.from(target.imageUrl.split(',')[1] || '', 'base64');
    }

    const possiblePaths = [
      target.imageUrl,
      target.value,
      target.label,
    ]
      .filter((value): value is string => !!value)
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !/^https?:\/\//i.test(value));

    for (const candidate of possiblePaths) {
      const resolved = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(process.cwd(), candidate);
      if (fs.existsSync(resolved)) {
        return fs.promises.readFile(resolved);
      }
    }

    return undefined;
  }

  private compareRegion(
    source: DecodedPng,
    template: DecodedPng,
    bounds: { x: number; y: number; width: number; height: number },
  ) {
    const targetWidth = Math.max(1, Math.round(bounds.width));
    const targetHeight = Math.max(1, Math.round(bounds.height));
    let totalDiff = 0;
    let sampled = 0;

    for (let ty = 0; ty < template.height; ty += 1) {
      const sy = Math.min(
        source.height - 1,
        Math.max(0, bounds.y + Math.floor((ty / template.height) * targetHeight)),
      );
      for (let tx = 0; tx < template.width; tx += 1) {
        const sx = Math.min(
          source.width - 1,
          Math.max(0, bounds.x + Math.floor((tx / template.width) * targetWidth)),
        );
        const sourceGray = this.grayAt(source, sx, sy);
        const templateGray = this.grayAt(template, tx, ty);
        totalDiff += Math.abs(sourceGray - templateGray);
        sampled += 1;
      }
    }

    if (sampled === 0) {
      return 0;
    }

    return Math.max(0, 1 - totalDiff / (sampled * 255));
  }

  private grayAt(image: DecodedPng, x: number, y: number) {
    const index = (y * image.width + x) * 4;
    const r = image.rgba[index] || 0;
    const g = image.rgba[index + 1] || 0;
    const b = image.rgba[index + 2] || 0;
    const a = image.rgba[index + 3] ?? 255;
    const alpha = a / 255;
    return Math.round((0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha));
  }

  private decodePng(buffer: Buffer): DecodedPng {
    const signature = buffer.subarray(0, 8);
    if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('Only PNG templates are supported for image matching');
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Buffer[] = [];

    while (offset < buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const data = buffer.subarray(offset + 8, offset + 8 + length);
      offset += 12 + length;

      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
      } else if (type === 'IDAT') {
        idatChunks.push(data);
      } else if (type === 'IEND') {
        break;
      }
    }

    if (bitDepth !== 8) {
      throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
    }

    const inflated = inflateSync(Buffer.concat(idatChunks));
    const channels = this.getChannels(colorType);
    const bytesPerPixel = channels;
    const stride = width * bytesPerPixel;
    const rgba = new Uint8Array(width * height * 4);
    const previous = new Uint8Array(stride);
    let sourceOffset = 0;
    let targetOffset = 0;

    for (let y = 0; y < height; y += 1) {
      const filterType = inflated[sourceOffset++];
      const row = inflated.subarray(sourceOffset, sourceOffset + stride);
      sourceOffset += stride;
      const defiltered = this.defilterRow(filterType, row, previous, bytesPerPixel);
      previous.set(defiltered);

      for (let x = 0; x < width; x += 1) {
        const pixelOffset = x * channels;
        const r = defiltered[pixelOffset];
        const g = channels >= 3 ? defiltered[pixelOffset + 1] : r;
        const b = channels >= 3 ? defiltered[pixelOffset + 2] : r;
        const a = colorType === 6 ? defiltered[pixelOffset + 3] : 255;
        rgba[targetOffset++] = r;
        rgba[targetOffset++] = g;
        rgba[targetOffset++] = b;
        rgba[targetOffset++] = a;
      }
    }

    return { width, height, rgba };
  }

  private getChannels(colorType: number) {
    switch (colorType) {
      case 0:
        return 1;
      case 2:
        return 3;
      case 6:
        return 4;
      default:
        throw new Error(`Unsupported PNG color type: ${colorType}`);
    }
  }

  private defilterRow(filterType: number, row: Uint8Array, previous: Uint8Array, bytesPerPixel: number) {
    const output = new Uint8Array(row.length);

    for (let i = 0; i < row.length; i += 1) {
      const raw = row[i];
      const left = i >= bytesPerPixel ? output[i - bytesPerPixel] : 0;
      const up = previous[i] || 0;
      const upperLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] || 0 : 0;

      switch (filterType) {
        case 0:
          output[i] = raw;
          break;
        case 1:
          output[i] = (raw + left) & 0xff;
          break;
        case 2:
          output[i] = (raw + up) & 0xff;
          break;
        case 3:
          output[i] = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          output[i] = (raw + this.paethPredictor(left, up, upperLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter type: ${filterType}`);
      }
    }

    return output;
  }

  private paethPredictor(a: number, b: number, c: number) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);

    if (pa <= pb && pa <= pc) {
      return a;
    }
    if (pb <= pc) {
      return b;
    }
    return c;
  }
}
