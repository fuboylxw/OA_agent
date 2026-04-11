export type AttachmentBindScope = 'field' | 'general';
export type AttachmentPhase = 'draft' | 'submit' | 'supplement' | 'rework' | 'history';
export type AttachmentPreviewStatus = 'none' | 'pending' | 'ready' | 'failed' | 'unsupported';

export interface AttachmentRef {
  attachmentId: string;
  fileId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fieldKey?: string | null;
  bindScope?: AttachmentBindScope;
  previewStatus?: AttachmentPreviewStatus;
  canPreview?: boolean;
  previewUrl?: string;
  downloadUrl?: string;
}

export interface AttachmentPayloadItem {
  filename: string;
  mimeType: string;
  content: Buffer;
  fieldKey?: string | null;
  bindScope?: AttachmentBindScope;
}

export interface CollectedAttachmentRef {
  fieldKey: string | null;
  bindScope: AttachmentBindScope;
  ref: AttachmentRef;
}
