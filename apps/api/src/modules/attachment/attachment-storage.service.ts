import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  copyFile,
  createReadStream,
  existsSync,
  mkdirSync,
  promises as fs,
} from 'fs';
import { basename, extname, join } from 'path';
import { promisify } from 'util';
import { ATTACHMENT_ROOT_DIR } from './attachment-upload.config';

const copyFileAsync = promisify(copyFile);

@Injectable()
export class AttachmentStorageService {
  private readonly rawDir = join(ATTACHMENT_ROOT_DIR, 'raw');
  private readonly previewDir = join(ATTACHMENT_ROOT_DIR, 'preview');

  constructor() {
    for (const dir of [ATTACHMENT_ROOT_DIR, this.rawDir, this.previewDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  async persistUploadedFile(file: Express.Multer.File, assetId: string) {
    const extension = extname(file.originalname).toLowerCase();
    const storageKey = join('raw', `${assetId}${extension}`);
    const targetPath = this.resolveStoragePath(storageKey);
    const fileBuffer = await fs.readFile(file.path);
    const sha256 = createHash('sha256').update(fileBuffer).digest('hex');

    await fs.rename(file.path, targetPath);

    return {
      storageKey,
      extension,
      sha256,
    };
  }

  async savePreviewFile(assetId: string, sourcePath: string, extension = '.pdf') {
    const previewKey = join('preview', `${assetId}${extension}`);
    const targetPath = this.resolveStoragePath(previewKey);
    await copyFileAsync(sourcePath, targetPath);
    return previewKey;
  }

  resolveStoragePath(storageKey: string) {
    return join(ATTACHMENT_ROOT_DIR, storageKey);
  }

  createStream(storageKey: string) {
    return createReadStream(this.resolveStoragePath(storageKey));
  }

  async readBuffer(storageKey: string) {
    return fs.readFile(this.resolveStoragePath(storageKey));
  }

  async exists(storageKey?: string | null) {
    if (!storageKey) {
      return false;
    }

    try {
      await fs.access(this.resolveStoragePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(storageKey?: string | null) {
    if (!storageKey) {
      return;
    }

    try {
      await fs.unlink(this.resolveStoragePath(storageKey));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async createTempPreviewDir(assetId: string) {
    const dir = join(ATTACHMENT_ROOT_DIR, 'tmp-preview', assetId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async removeDir(path: string) {
    await fs.rm(path, { recursive: true, force: true });
  }

  toDownloadName(originalName: string) {
    return basename(originalName);
  }
}
