import { HttpException, HttpStatus } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { normalizeAttachmentFileName } from './attachment.utils';

export const ATTACHMENT_ROOT_DIR = join(process.cwd(), 'uploads', 'attachments');
export const ATTACHMENT_TEMP_DIR = join(ATTACHMENT_ROOT_DIR, 'tmp');

const DEFAULT_ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.pdf', '.txt', '.md', '.csv', '.json',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm',
];

const MAX_ATTACHMENT_FILES = parseInt(process.env.ATTACHMENT_MAX_FILES || '10', 10);
const MAX_ATTACHMENT_FILE_SIZE = parseInt(
  process.env.ATTACHMENT_MAX_FILE_SIZE_BYTES || `${20 * 1024 * 1024}`,
  10,
);

function ensureAttachmentTempDir() {
  if (!existsSync(ATTACHMENT_TEMP_DIR)) {
    mkdirSync(ATTACHMENT_TEMP_DIR, { recursive: true });
  }
}

ensureAttachmentTempDir();

export const attachmentUploadInterceptorOptions = {
  storage: diskStorage({
    destination: (_req: any, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
      cb(null, ATTACHMENT_TEMP_DIR);
    },
    filename: (_req: any, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = extname(normalizeAttachmentFileName(file.originalname) || file.originalname).toLowerCase();
      cb(null, `${uniqueSuffix}${ext}`);
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_FILE_SIZE, files: MAX_ATTACHMENT_FILES },
  fileFilter: (_req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
    const extension = extname(normalizeAttachmentFileName(file.originalname) || file.originalname).toLowerCase();
    if (DEFAULT_ALLOWED_EXTENSIONS.includes(extension)) {
      cb(null, true);
      return;
    }

    cb(new HttpException('不支持的文件类型', HttpStatus.BAD_REQUEST), false);
  },
};
