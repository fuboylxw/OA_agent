'use client';

import OaFormPreview, { OaFormField } from './OaFormPreview';

export interface ActionButton {
  label: string;
  action: string;
  type: 'primary' | 'default' | 'danger';
}

export interface ProcessCard {
  processInstanceId: string;
  processCode: string;
  processName: string;
  processCategory?: string | null;
  processStatus?: string;
  stage: 'collecting' | 'confirming' | 'executing' | 'submitted' | 'rework' | 'completed' | 'failed' | 'cancelled';
  actionState: 'available' | 'readonly';
  canContinue: boolean;
  statusText: string;
  formData?: Record<string, any>;
  fields: OaFormField[];
  missingFields?: Array<{ key: string; label: string; question: string; type?: string }>;
  actionButtons?: ActionButton[];
  needsAttachment?: boolean;
  draftId?: string;
  submissionId?: string;
  oaSubmissionId?: string | null;
  reworkHint?: 'supplement' | 'modify' | 'unknown';
  reworkReason?: string | null;
  updatedAt: string;
}

function getTone(stage: ProcessCard['stage']): 'blue' | 'amber' | 'green' | 'red' | 'gray' {
  switch (stage) {
    case 'collecting':
      return 'blue';
    case 'confirming':
      return 'amber';
    case 'executing':
      return 'blue';
    case 'submitted':
      return 'blue';
    case 'rework':
      return 'amber';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'gray';
    default:
      return 'gray';
  }
}

function getActionButtonClass(type: ActionButton['type']) {
  switch (type) {
    case 'primary':
      return 'bg-sky-600 text-white hover:bg-sky-700';
    case 'danger':
      return 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50';
    default:
      return 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  }
}

export default function ProcessConversationCard({
  card,
  actionButtons,
  onAction,
  disabled = false,
}: {
  card: ProcessCard;
  actionButtons?: ActionButton[];
  onAction?: (action: string) => void;
  disabled?: boolean;
}) {
  const effectiveButtons = card.actionState === 'available' ? (actionButtons || card.actionButtons || []) : [];
  const subtitleParts = [
    card.processCategory || null,
    card.oaSubmissionId ? `单号 ${card.oaSubmissionId}` : null,
    card.updatedAt ? `更新于 ${new Date(card.updatedAt).toLocaleString('zh-CN')}` : null,
  ].filter(Boolean);

  const footer = (
    <div className="space-y-4">
      {card.reworkReason ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="mb-2 text-sm font-semibold text-amber-900">OA 驳回原因</div>
          <div className="text-sm leading-6 text-amber-900">{card.reworkReason}</div>
        </div>
      ) : null}

      {Array.isArray(card.missingFields) && card.missingFields.length > 0 ? (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-4 py-4">
          <div className="mb-2 text-sm font-semibold text-amber-900">待补充信息</div>
          <ol className="space-y-2 text-sm text-amber-900">
            {card.missingFields.map((field, index) => (
              <li key={field.key}>
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-amber-700">
                  {index + 1}
                </span>
                {field.question}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {card.actionState === 'available' && effectiveButtons.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {effectiveButtons.map((button) => (
            <button
              key={button.action}
              onClick={() => onAction?.(button.action)}
              disabled={disabled}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${getActionButtonClass(button.type)}`}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <i className="fas fa-lock text-xs text-slate-400"></i>
          <span>
            {card.canContinue
              ? card.stage === 'rework'
                ? '当前申请已被退回，请根据驳回原因在对话框继续处理。'
                : '当前流程可继续办理，请在对话框继续补充信息。'
              : card.stage === 'submitted'
                ? '当前申请已提交到 OA，等待审批结果。'
                : '历史记录仅供查看，不能再次操作。'}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <OaFormPreview
      title={card.processName}
      subtitle={subtitleParts.join(' · ')}
      statusLabel={card.statusText}
      tone={getTone(card.stage)}
      fields={card.fields}
      emptyText="当前没有可展示的表单字段"
      footer={footer}
    />
  );
}
