'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface OaFormField {
  key: string;
  label: string;
  value: any;
  displayValue: any;
  type: string;
  required?: boolean;
  description?: string;
  example?: string;
  multiple?: boolean;
  options?: Array<{ label: string; value: string }>;
  origin?: 'user' | 'derived' | 'prefill';
  tagLabel?: string;
  tagTone?: 'sky' | 'amber' | 'slate';
  hint?: string;
}

const TONE_CLASS_MAP: Record<
  string,
  { badge: string; border: string; panel: string; title: string }
> = {
  blue: {
    badge: 'bg-sky-100 text-sky-700',
    border: 'border-sky-200',
    panel: 'bg-sky-50/60',
    title: 'text-sky-900',
  },
  amber: {
    badge: 'bg-amber-100 text-amber-800',
    border: 'border-amber-200',
    panel: 'bg-amber-50/70',
    title: 'text-amber-950',
  },
  green: {
    badge: 'bg-emerald-100 text-emerald-700',
    border: 'border-emerald-200',
    panel: 'bg-emerald-50/70',
    title: 'text-emerald-950',
  },
  red: {
    badge: 'bg-rose-100 text-rose-700',
    border: 'border-rose-200',
    panel: 'bg-rose-50/70',
    title: 'text-rose-950',
  },
  gray: {
    badge: 'bg-slate-100 text-slate-700',
    border: 'border-slate-200',
    panel: 'bg-slate-50/80',
    title: 'text-slate-900',
  },
};

function renderFieldValue(field: OaFormField) {
  if (Array.isArray(field.value) && field.value.length > 0 && field.value[0]?.fileName) {
    return (
      <div className="flex flex-col gap-2">
        {field.value.map((file: any) => (
          <div
            key={`${field.key}-${file.fileId || file.fileName}`}
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
          >
            <i className="fas fa-paperclip text-[10px] text-slate-400"></i>
            <span className="max-w-[220px] truncate font-medium text-slate-700">{file.fileName}</span>
            {file.previewUrl ? (
              <a
                href={file.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-sky-100 hover:text-sky-700"
              >
                预览
              </a>
            ) : null}
            {file.downloadUrl ? (
              <a
                href={file.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
              >
                下载
              </a>
            ) : null}
            {file.previewStatus && !file.previewUrl ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                {file.previewStatus === 'pending'
                  ? '预览生成中'
                  : file.previewStatus === 'failed'
                    ? '预览失败'
                    : file.previewStatus === 'unsupported'
                      ? '仅支持下载'
                      : '待处理'}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  const displayValue = field.displayValue;
  if (displayValue === null || displayValue === undefined || displayValue === '') {
    return <span className="text-slate-400">未填写</span>;
  }

  if (typeof displayValue === 'object') {
    return (
      <pre className="overflow-x-auto rounded-xl bg-white px-4 py-3 text-xs text-slate-700">
        {JSON.stringify(displayValue, null, 2)}
      </pre>
    );
  }

  return <span className="whitespace-pre-wrap break-words text-slate-900">{String(displayValue)}</span>;
}

function getFieldTagClass(tone?: OaFormField['tagTone']) {
  switch (tone) {
    case 'amber':
      return 'bg-amber-50 text-amber-700';
    case 'slate':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-sky-50 text-sky-700';
  }
}

function toEditableValue(field: OaFormField) {
  if (Array.isArray(field.value)) {
    if (field.value.length > 0 && field.value[0]?.fileName) {
      return '';
    }
    return field.value.map((item) => String(item ?? '').trim()).filter(Boolean).join('、');
  }

  if (field.displayValue === null || field.displayValue === undefined) {
    return '';
  }

  if (typeof field.displayValue === 'object') {
    return JSON.stringify(field.displayValue);
  }

  return String(field.displayValue);
}

function isInlineEditableField(field: OaFormField) {
  return field.type !== 'file' && field.type !== 'json';
}

export default function OaFormPreview({
  title,
  subtitle,
  statusLabel,
  tone = 'gray',
  fields,
  emptyText = '暂无表单内容',
  footer,
  editable = false,
  editingDisabled = false,
  onCommitFieldEdit,
}: {
  title?: string;
  subtitle?: string;
  statusLabel?: string;
  tone?: 'blue' | 'amber' | 'green' | 'red' | 'gray';
  fields: OaFormField[];
  emptyText?: string;
  footer?: ReactNode;
  editable?: boolean;
  editingDisabled?: boolean;
  onCommitFieldEdit?: (field: OaFormField, nextValue: string) => Promise<void> | void;
}) {
  const toneClasses = TONE_CLASS_MAP[tone] || TONE_CLASS_MAP.gray;
  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [savingFieldKey, setSavingFieldKey] = useState<string | null>(null);
  const [editError, setEditError] = useState('');
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editingFieldKey || !editorRef.current) {
      return;
    }

    editorRef.current.focus();
    editorRef.current.select();
  }, [editingFieldKey]);

  const startEditing = (field: OaFormField) => {
    if (!editable || editingDisabled || !onCommitFieldEdit || !isInlineEditableField(field)) {
      return;
    }

    setEditingFieldKey(field.key);
    setDraftValue(toEditableValue(field));
    setEditError('');
  };

  const cancelEditing = () => {
    if (savingFieldKey) {
      return;
    }
    setEditingFieldKey(null);
    setDraftValue('');
    setEditError('');
  };

  const commitEditing = async (field: OaFormField) => {
    const nextValue = draftValue.trim();
    if (!nextValue) {
      setEditError('请输入修改后的内容');
      return;
    }
    if (!onCommitFieldEdit) {
      cancelEditing();
      return;
    }

    try {
      setSavingFieldKey(field.key);
      setEditError('');
      await onCommitFieldEdit(field, nextValue);
      setEditingFieldKey(null);
      setDraftValue('');
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || '字段修改失败，请稍后重试';
      setEditError(typeof message === 'string' ? message : '字段修改失败，请稍后重试');
    } finally {
      setSavingFieldKey(null);
    }
  };

  return (
    <section className={`overflow-hidden rounded-2xl border ${toneClasses.border} bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]`}>
      {(title || subtitle || statusLabel) && (
        <div className={`border-b ${toneClasses.border} ${toneClasses.panel} px-5 py-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {title && <h3 className={`text-base font-semibold ${toneClasses.title}`}>{title}</h3>}
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {statusLabel && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${toneClasses.badge}`}>
                {statusLabel}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="bg-[linear-gradient(180deg,#fff_0%,#f8fafc_100%)] px-5 py-5">
        {fields.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {emptyText}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {fields.map((field) => {
              const isEditing = editingFieldKey === field.key;
              const canEdit = editable && !editingDisabled && Boolean(onCommitFieldEdit) && isInlineEditableField(field);
              const isSaving = savingFieldKey === field.key;
              return (
                <div
                  key={field.key}
                  className={`rounded-2xl border bg-white px-4 py-4 transition-colors ${
                    field.type === 'json' || field.type === 'textarea' ? 'md:col-span-2' : ''
                  } ${
                    canEdit
                      ? 'cursor-text border-sky-200 hover:border-sky-300 hover:bg-sky-50/30'
                      : 'border-slate-200'
                  } ${isEditing ? 'border-sky-400 ring-2 ring-sky-100' : ''}`}
                  onClick={() => {
                    if (!isEditing) {
                      startEditing(field);
                    }
                  }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                      {field.label}
                    </span>
                    {field.required && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                        必填
                      </span>
                    )}
                    {field.tagLabel && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getFieldTagClass(field.tagTone)}`}>
                        {field.tagLabel}
                      </span>
                    )}
                    {canEdit && !isEditing ? (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                        点击可改
                      </span>
                    ) : null}
                  </div>

                  <div className="text-sm leading-6">
                    {isEditing ? (
                      <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
                        {field.type === 'textarea' ? (
                          <textarea
                            ref={(node) => {
                              editorRef.current = node;
                            }}
                            rows={4}
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            onKeyDown={(event) => {
                              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                                event.preventDefault();
                                void commitEditing(field);
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelEditing();
                              }
                            }}
                            disabled={isSaving}
                            className="w-full rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-400"
                          />
                        ) : (
                          <input
                            ref={(node) => {
                              editorRef.current = node;
                            }}
                            type="text"
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void commitEditing(field);
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelEditing();
                              }
                            }}
                            disabled={isSaving}
                            className="w-full rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-400"
                          />
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{field.type === 'textarea' ? 'Ctrl/⌘ + Enter 保存，Esc 取消' : 'Enter 保存，Esc 取消'}</span>
                          {Array.isArray(field.options) && field.options.length > 0 ? (
                            <span>可选值：{field.options.map((option) => option.label).join('、')}</span>
                          ) : null}
                        </div>

                        {editError ? (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                            {editError}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void commitEditing(field)}
                            disabled={isSaving}
                            className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSaving ? '保存中...' : '保存修改'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            disabled={isSaving}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      renderFieldValue(field)
                    )}
                  </div>
                  {field.description ? (
                    <div className="mt-2 text-xs leading-5 text-slate-600">
                      说明：{field.description}
                    </div>
                  ) : null}
                  {field.example ? (
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      示例：{field.example}
                    </div>
                  ) : null}
                  {field.type === 'file' && field.multiple ? (
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      支持上传多份文件
                    </div>
                  ) : null}
                  {field.hint ? (
                    <div className="mt-2 text-xs leading-5 text-slate-500">{field.hint}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {footer ? (
        <div className={`border-t ${toneClasses.border} ${toneClasses.panel} px-5 py-4`}>
          {footer}
        </div>
      ) : null}
    </section>
  );
}
