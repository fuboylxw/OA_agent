import { extname } from 'path';
import type {
  AttachmentBindScope,
  AttachmentPreviewStatus,
  AttachmentRef,
  CollectedAttachmentRef,
} from './attachment.types';

const DIRECT_PREVIEW_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.pdf', '.txt', '.md', '.csv', '.json',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
]);

const OFFICE_PREVIEW_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);

const GENERAL_ATTACHMENT_KEYS = new Set([
  'attachments',
  'generalAttachments',
  'supplementaryAttachments',
  'supportingDocuments',
]);

export function normalizeExtension(input?: string | null) {
  if (!input) {
    return '';
  }

  const normalized = input.startsWith('.') ? input : extname(input);
  return normalized.toLowerCase();
}

export function getAttachmentPreviewStatus(
  mimeType?: string | null,
  extension?: string | null,
): AttachmentPreviewStatus {
  const ext = normalizeExtension(extension);
  const mime = (mimeType || '').toLowerCase();

  if (
    DIRECT_PREVIEW_EXTENSIONS.has(ext)
    || mime.startsWith('image/')
    || mime.startsWith('text/')
    || mime === 'application/pdf'
    || mime.startsWith('audio/')
    || mime.startsWith('video/')
  ) {
    return 'ready';
  }

  if (OFFICE_PREVIEW_EXTENSIONS.has(ext)) {
    return 'pending';
  }

  return 'unsupported';
}

export function canPreviewAttachment(
  mimeType?: string | null,
  extension?: string | null,
  previewStatus?: AttachmentPreviewStatus | null,
) {
  const effectiveStatus = previewStatus || getAttachmentPreviewStatus(mimeType, extension);
  return effectiveStatus === 'ready';
}

export function isAttachmentRef(value: unknown): value is AttachmentRef {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as unknown as Record<string, unknown>;
  return typeof record.attachmentId === 'string'
    || typeof record.fileId === 'string';
}

export function normalizeAttachmentRef(value: unknown): AttachmentRef | null {
  if (!isAttachmentRef(value)) {
    return null;
  }

  const record = value as unknown as Record<string, unknown>;
  const attachmentId = String(record.attachmentId || record.fileId || '').trim();
  const fileName = typeof record.fileName === 'string' ? record.fileName : '';
  const fileSize = Number(record.fileSize || 0);
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : 'application/octet-stream';
  const bindScope = record.bindScope === 'general' ? 'general' : 'field';
  const previewStatus = typeof record.previewStatus === 'string'
    ? record.previewStatus as AttachmentPreviewStatus
    : getAttachmentPreviewStatus(mimeType, extname(fileName));

  if (!attachmentId || !fileName) {
    return null;
  }

  return {
    attachmentId,
    fileId: attachmentId,
    fileName,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    mimeType,
    fieldKey: typeof record.fieldKey === 'string' ? record.fieldKey : null,
    bindScope,
    previewStatus,
    canPreview: typeof record.canPreview === 'boolean'
      ? record.canPreview
      : canPreviewAttachment(mimeType, extname(fileName), previewStatus),
    previewUrl: typeof record.previewUrl === 'string' ? record.previewUrl : undefined,
    downloadUrl: typeof record.downloadUrl === 'string' ? record.downloadUrl : undefined,
  };
}

export function collectAttachmentRefs(formData?: Record<string, any> | null): CollectedAttachmentRef[] {
  if (!formData || typeof formData !== 'object') {
    return [];
  }

  const refs: CollectedAttachmentRef[] = [];

  for (const [fieldKey, value] of Object.entries(formData)) {
    if (Array.isArray(value)) {
      const scope: AttachmentBindScope = GENERAL_ATTACHMENT_KEYS.has(fieldKey) ? 'general' : 'field';
      for (const item of value) {
        const ref = normalizeAttachmentRef(item);
        if (!ref) {
          continue;
        }
        refs.push({
          fieldKey: scope === 'general' ? null : (ref.fieldKey || fieldKey),
          bindScope: ref.bindScope || scope,
          ref,
        });
      }
      continue;
    }

    const ref = normalizeAttachmentRef(value);
    if (!ref) {
      continue;
    }

    refs.push({
      fieldKey: ref.fieldKey || fieldKey,
      bindScope: ref.bindScope || 'field',
      ref,
    });
  }

  return refs;
}

export function omitAttachmentFields(
  formData: Record<string, any>,
  schema?: { fields?: Array<{ key: string; type?: string }> } | null,
) {
  const result: Record<string, any> = { ...formData };
  const fileFieldKeys = new Set(
    (schema?.fields || [])
      .filter((field) => (field.type || '').toLowerCase() === 'file')
      .map((field) => field.key),
  );

  for (const key of Object.keys(result)) {
    if (fileFieldKeys.has(key) || GENERAL_ATTACHMENT_KEYS.has(key)) {
      delete result[key];
    }
  }

  return result;
}
