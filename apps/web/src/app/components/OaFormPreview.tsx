'use client';

import type { ReactNode } from 'react';

export interface OaFormField {
  key: string;
  label: string;
  value: any;
  displayValue: any;
  type: string;
  required?: boolean;
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

export default function OaFormPreview({
  title,
  subtitle,
  statusLabel,
  tone = 'gray',
  fields,
  emptyText = '暂无表单内容',
  footer,
}: {
  title?: string;
  subtitle?: string;
  statusLabel?: string;
  tone?: 'blue' | 'amber' | 'green' | 'red' | 'gray';
  fields: OaFormField[];
  emptyText?: string;
  footer?: ReactNode;
}) {
  const toneClasses = TONE_CLASS_MAP[tone] || TONE_CLASS_MAP.gray;

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
            {fields.map((field) => (
              <div
                key={field.key}
                className={`rounded-2xl border border-slate-200 bg-white px-4 py-4 ${
                  field.type === 'json' || field.type === 'textarea' ? 'md:col-span-2' : ''
                }`}
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
                </div>
                <div className="text-sm leading-6">{renderFieldValue(field)}</div>
              </div>
            ))}
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
