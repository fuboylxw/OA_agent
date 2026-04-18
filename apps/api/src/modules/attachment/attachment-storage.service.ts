import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  copyFile,
  createReadStream,
  existsSync,
  mkdirSync,
  promises as fs,
} from 'fs';
import { basename, extname, join, posix } from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { ATTACHMENT_ROOT_DIR } from './attachment-upload.config';
import { MinioObjectStorageClient } from './minio-object-storage.client';
import { normalizeAttachmentFileName } from './attachment.utils';

const copyFileAsync = promisify(copyFile);

@Injectable()
export class AttachmentStorageService {
  private readonly driver = (process.env.ATTACHMENT_STORAGE_DRIVER || 'local').trim().toLowerCase();
  private readonly rawDir = join(ATTACHMENT_ROOT_DIR, 'raw');
  private readonly previewDir = join(ATTACHMENT_ROOT_DIR, 'preview');
  private readonly minioClient =
    this.driver === 'minio'
      ? new MinioObjectStorageClient({
          endpoint: process.env.MINIO_ENDPOINT || 'localhost',
          port: parseInt(process.env.MINIO_PORT || '9000', 10),
          accessKey: process.env.MINIO_ACCESS_KEY || '',
          secretKey: process.env.MINIO_SECRET_KEY || '',
          bucket: process.env.MINIO_BUCKET || 'uniflow-attachments',
          useSSL: process.env.MINIO_USE_SSL === 'true',
        })
      : null;

  constructor() {
    const directories = this.driver === 'minio'
      ? [ATTACHMENT_ROOT_DIR]
      : [ATTACHMENT_ROOT_DIR, this.rawDir, this.previewDir];

    for (const dir of directories) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  async persistUploadedFile(file: Express.Multer.File, assetId: string) {
    const extension = extname(normalizeAttachmentFileName(file.originalname) || file.originalname).toLowerCase();
    const storageKey = posix.join('raw', `${assetId}${extension}`);
    const fileBuffer = await fs.readFile(file.path);
    const sha256 = createHash('sha256').update(fileBuffer).digest('hex');

    if (this.minioClient) {
      await this.minioClient.putObject(storageKey, fileBuffer, file.mimetype || 'application/octet-stream');
      await fs.unlink(file.path);
    } else {
      const targetPath = this.resolveStoragePath(storageKey);
      await fs.rename(file.path, targetPath);
    }

    return {
      storageKey,
      extension,
      sha256,
    };
  }

  async savePreviewFile(assetId: string, sourcePath: string, extension = '.pdf') {
    const previewKey = posix.join('preview', `${assetId}${extension}`);

    if (this.minioClient) {
      const fileBuffer = await fs.readFile(sourcePath);
      await this.minioClient.putObject(previewKey, fileBuffer, 'application/pdf');
    } else {
      const targetPath = this.resolveStoragePath(previewKey);
      await copyFileAsync(sourcePath, targetPath);
    }

    return previewKey;
  }

  resolveStoragePath(storageKey: string) {
    return join(ATTACHMENT_ROOT_DIR, ...storageKey.split(/[\\/]+/).filter(Boolean));
  }

  async createStream(storageKey: string): Promise<Readable> {
    if (this.minioClient) {
      return this.minioClient.getObjectStream(storageKey);
    }

    return createReadStream(this.resolveStoragePath(storageKey));
  }

  async readBuffer(storageKey: string) {
    if (this.minioClient) {
      return this.minioClient.getObjectBuffer(storageKey);
    }

    return fs.readFile(this.resolveStoragePath(storageKey));
  }

  async exists(storageKey?: string | null) {
    if (!storageKey) {
      return false;
    }

    if (this.minioClient) {
      return this.minioClient.objectExists(storageKey);
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

    if (this.minioClient) {
      await this.minioClient.deleteObject(storageKey);
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

  async materializeToTempFile(storageKey: string, tempDir: string, preferredName?: string | null) {
    const fileName = normalizeAttachmentFileName(preferredName)
      || basename(preferredName || storageKey);
    const targetPath = join(tempDir, fileName);

    if (this.minioClient) {
      const fileBuffer = await this.minioClient.getObjectBuffer(storageKey);
      await fs.writeFile(targetPath, fileBuffer);
      return targetPath;
    }

    await copyFileAsync(this.resolveStoragePath(storageKey), targetPath);
    return targetPath;
  }

  async removeDir(path: string) {
    await fs.rm(path, { recursive: true, force: true });
  }

  getStorageType() {
    return this.minioClient ? 'minio' : 'local';
  }

  toDownloadName(originalName: string) {
    return normalizeAttachmentFileName(originalName) || basename(originalName);
  }
}
