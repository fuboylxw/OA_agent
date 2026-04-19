'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import OaFormPreview from '../components/OaFormPreview';
import { authFetch } from '../lib/api-client';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { getClientSessionToken } from '../lib/client-auth';

const STATUS_MAP: Record<string, { label: string; bgClass: string; textClass: string }> = {
  editing: { label: '待补充', bgClass: 'bg-sky-100', textClass: 'text-sky-700' },
  draft_saved: { label: '已保存待发', bgClass: 'bg-amber-100', textClass: 'text-amber-700' },
  pending: { label: '待处理', bgClass: 'bg-orange-100', textClass: 'text-orange-600' },
  submitted: { label: '已提交', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  approved: { label: '已通过', bgClass: 'bg-green-100', textClass: 'text-green-600' },
  rejected: { label: '已驳回', bgClass: 'bg-red-100', textClass: 'text-red-600' },
  failed: { label: '失败', bgClass: 'bg-red-100', textClass: 'text-red-600' },
  cancelled: { label: '已撤回', bgClass: 'bg-gray-100', textClass: 'text-gray-600' },
};

type SubmissionFilter = 'all' | 'processing' | 'completed' | 'failed';

const MOBILE_FILTERS: Array<{ key: SubmissionFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'processing', label: '处理中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
];

interface FieldWithLabel {
  key: string;
  label: string;
  value: any;
  displayValue: any;
  type: string;
  required?: boolean;
}

interface Submission {
  id: string;
  sourceType?: 'submission' | 'draft';
  draftId?: string | null;
  submissionId?: string | null;
  oaSubmissionId?: string;
  processCode?: string;
  processName?: string;
  processCategory?: string;
  connectorName?: string | null;
  sessionId?: string | null;
  restoreStatus?: string | null;
  restoreExpiresAt?: string | null;
  retainedUntil?: string | null;
  canRestoreConversation?: boolean;
  status: string;
  statusText?: string;
  formData: Record<string, any>;
  formDataWithLabels?: FieldWithLabel[];
  user?: { id: string; username: string; displayName: string };
  submittedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

function isProcessingSubmission(status: string) {
  return status === 'editing' || status === 'draft_saved' || status === 'pending' || status === 'submitted';
}

function isCompletedSubmission(status: string) {
  return status === 'approved';
}

function isFailedSubmission(status: string) {
  return status === 'rejected' || status === 'failed' || status === 'cancelled';
}

function matchesSubmissionFilter(submission: Submission, filter: SubmissionFilter) {
  switch (filter) {
    case 'processing':
      return isProcessingSubmission(submission.status);
    case 'completed':
      return isCompletedSubmission(submission.status);
    case 'failed':
      return isFailedSubmission(submission.status);
    default:
      return true;
  }
}

function getSubmissionDisplayTime(submission: Submission) {
  return submission.sourceType === 'draft'
    ? (submission.updatedAt || submission.createdAt)
    : (submission.submittedAt || submission.createdAt);
}

function getSubmissionTimeLabel(submission: Submission) {
  return submission.sourceType === 'draft' ? '更新于' : '提交于';
}

function getSubmissionRowId(submission: Submission) {
  return submission.oaSubmissionId
    || (submission.sourceType === 'draft'
      ? `草稿 ${submission.id.substring(0, 8)}`
      : submission.id.substring(0, 8));
}

function getSubmissionSystemName(submission: Submission) {
  const name = submission.connectorName?.trim();
  return name && name.length > 0 ? name : '未关联系统';
}

export default function SubmissionsContent({
  initialSubmissions,
}: {
  initialSubmissions: Submission[];
}) {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [mobileFilter, setMobileFilter] = useState<SubmissionFilter>('all');

  const getStatus = (status: string) => STATUS_MAP[status] || {
    label: status,
    bgClass: 'bg-blue-100',
    textClass: 'text-blue-600',
  };

  const toggleExpand = (id: string) => setExpandedId(expandedId === id ? null : id);

  const getTone = (status: string): 'blue' | 'amber' | 'green' | 'red' | 'gray' => {
    switch (status) {
      case 'editing':
      case 'draft_saved':
        return 'amber';
      case 'submitted':
      case 'pending':
        return 'blue';
      case 'approved':
        return 'green';
      case 'rejected':
      case 'failed':
        return 'red';
      case 'cancelled':
        return 'gray';
      default:
        return 'amber';
    }
  };

  const handleRestoreConversation = async (submission: Submission) => {
    setRestoringId(submission.id);
    try {
      const response = await authFetch(withBrowserApiBase('/api/v1/assistant/sessions/restore'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: submission.sessionId || undefined,
          submissionId: submission.sourceType === 'submission'
            ? (submission.submissionId || submission.id)
            : undefined,
          draftId: submission.sourceType === 'draft'
            ? (submission.draftId || submission.id)
            : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error('restore failed');
      }
      const data = await response.json();
      const nextSessionId = data?.session?.id || data?.sessionId || submission.sessionId;
      if (nextSessionId) {
        router.push(`/chat?sessionId=${encodeURIComponent(nextSessionId)}&resumePrompt=1`);
        return;
      }
      router.push('/chat');
    } catch (error) {
      console.error('Failed to restore conversation:', error);
    } finally {
      setRestoringId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const refreshSubmissions = async () => {
      try {
        const response = await authFetch(withBrowserApiBase('/api/v1/submissions'), {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const latest = await response.json();
        if (!cancelled) {
          setSubmissions(Array.isArray(latest) ? latest : []);
        }
      } catch {
        // Ignore refresh failures and keep showing the last successful state.
      }
    };

    const handleVisibleRefresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshSubmissions();
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshSubmissions();
    }, 60000);

    void refreshSubmissions();
    window.addEventListener('focus', handleVisibleRefresh);
    document.addEventListener('visibilitychange', handleVisibleRefresh);

    const token = getClientSessionToken();
    let es: EventSource | null = null;
    if (token) {
      const sseUrl = withBrowserApiBase(`/api/v1/submissions/events?token=${encodeURIComponent(token)}`);
      es = new EventSource(sseUrl);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            submissionId: string;
            status: string;
            statusText: string;
          };
          if (!cancelled) {
            setSubmissions((prev) =>
              prev.map((submission) =>
                submission.id === data.submissionId
                  ? { ...submission, status: data.status, statusText: data.statusText }
                  : submission,
              ),
            );
          }
        } catch {
          // ignore malformed events
        }
      };
      es.onerror = () => {
        // Let the browser auto-reconnect by not calling close()
      };
    }

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibleRefresh);
      document.removeEventListener('visibilitychange', handleVisibleRefresh);
      es?.close();
    };
  }, []);

  const filterCounts = useMemo(() => ({
    all: submissions.length,
    processing: submissions.filter((submission) => isProcessingSubmission(submission.status)).length,
    completed: submissions.filter((submission) => isCompletedSubmission(submission.status)).length,
    failed: submissions.filter((submission) => isFailedSubmission(submission.status)).length,
  }), [submissions]);

  const mobileSubmissions = useMemo(
    () => submissions.filter((submission) => matchesSubmissionFilter(submission, mobileFilter)),
    [mobileFilter, submissions],
  );

  const renderSubmissionPreview = (submission: Submission) => {
    const status = getStatus(submission.status);
    const displayTime = getSubmissionDisplayTime(submission);

    return (
      <OaFormPreview
        title={submission.processName || '申请单据'}
        subtitle={[
          getSubmissionSystemName(submission),
          submission.oaSubmissionId ? `单号 ${submission.oaSubmissionId}` : null,
          `${getSubmissionTimeLabel(submission)} ${new Date(displayTime).toLocaleString('zh-CN')}`,
        ].filter(Boolean).join(' · ')}
        statusLabel={submission.statusText || status.label}
        tone={getTone(submission.status)}
        fields={submission.formDataWithLabels || []}
        emptyText="暂无表单详情"
        footer={(
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span>状态：{submission.statusText || status.label}</span>
            {submission.user?.displayName ? <span>提交人：{submission.user.displayName}</span> : null}
            {submission.canRestoreConversation && submission.restoreExpiresAt ? (
              <span>对话可恢复至：{new Date(submission.restoreExpiresAt).toLocaleDateString('zh-CN')}</span>
            ) : null}
          </div>
        )}
      />
    );
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm">
            <i className="fas fa-file-alt text-sm"></i>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">我的申请</div>
            <div className="mt-1 truncate text-[11px] text-slate-500">
              查看进度、历史记录与恢复对话
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+1.5rem)] pt-4 md:hidden">
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {MOBILE_FILTERS.map((filter) => {
            const active = mobileFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setMobileFilter(filter.key)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                {filter.label} ({filterCounts[filter.key]})
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {mobileSubmissions.map((submission) => {
            const status = getStatus(submission.status);
            const isExpanded = expandedId === submission.id;
            const displayTime = getSubmissionDisplayTime(submission);
            return (
              <div key={submission.id} className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleExpand(submission.id)}
                  className="w-full px-4 py-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-900">
                        {submission.processName || '未知流程'}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {getSubmissionSystemName(submission)}
                      </div>
                    </div>
                    <span className={`inline-flex flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                      {submission.statusText || status.label}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{getSubmissionTimeLabel(submission)} {new Date(displayTime).toLocaleString('zh-CN')}</span>
                    <span>{isExpanded ? '收起详情' : '查看详情'}</span>
                  </div>
                </button>

                <div className="border-t border-slate-100 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(submission.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600"
                    >
                      <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`}></i>
                      {isExpanded ? '收起详情' : '查看详情'}
                    </button>
                    {submission.canRestoreConversation ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRestoreConversation(submission);
                        }}
                        disabled={restoringId === submission.id}
                        className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <i className="fas fa-rotate-left text-[10px]"></i>
                        {restoringId === submission.id ? '恢复中...' : '恢复对话'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isExpanded ? (
                  <div className="border-t border-slate-100 bg-[linear-gradient(180deg,#fbfdff_0%,#f8fafc_100%)] px-4 py-4">
                    {renderSubmissionPreview(submission)}
                  </div>
                ) : null}
              </div>
            );
          })}

          {mobileSubmissions.length === 0 ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white px-4 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <i className="fas fa-file-alt text-xl text-slate-400"></i>
              </div>
              <p className="text-sm text-slate-500">当前筛选下暂无申请记录</p>
              <Link
                href="/chat"
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white"
              >
                <i className="fas fa-plus text-xs"></i>
                发起新申请
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      <div className="hidden md:block">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="mb-2 text-2xl font-bold text-gray-900">我的申请</h1>
                <p className="text-gray-600">查看和管理您提交的所有申请</p>
              </div>
              <Link href="/chat" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700">
                <i className="fas fa-plus"></i>
                发起新申请
              </Link>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-6 md:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">全部申请</p>
                  <p className="text-2xl font-bold text-gray-900">{submissions.length}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <i className="fas fa-file-alt text-blue-600"></i>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">待处理</p>
                  <p className="text-2xl font-bold text-orange-600">{filterCounts.processing}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                  <i className="fas fa-clock text-orange-600"></i>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">已通过</p>
                  <p className="text-2xl font-bold text-green-600">{filterCounts.completed}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                  <i className="fas fa-check-circle text-green-600"></i>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">已驳回</p>
                  <p className="text-2xl font-bold text-red-600">{submissions.filter((submission) => submission.status === 'rejected' || submission.status === 'failed').length}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
                  <i className="fas fa-times-circle text-red-600"></i>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">申请编号</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">流程名称</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">分类</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">状态</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">提交时间</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => {
                    const status = getStatus(submission.status);
                    const isExpanded = expandedId === submission.id;
                    const rowId = getSubmissionRowId(submission);
                    const displayTime = getSubmissionDisplayTime(submission);
                    return (
                      <tr key={submission.id} className="border-b border-gray-200">
                        <td colSpan={6} className="p-0">
                          <div
                            className="flex cursor-pointer items-center transition-colors hover:bg-gray-50"
                            onClick={() => toggleExpand(submission.id)}
                          >
                            <div className="flex-shrink-0 px-6 py-4" style={{ width: '16.66%' }}>
                              <span className="text-sm font-mono text-gray-500">{rowId}</span>
                            </div>
                            <div className="flex-shrink-0 px-6 py-4" style={{ width: '16.66%' }}>
                              <span className="text-sm font-medium text-gray-900">{submission.processName || '未知流程'}</span>
                            </div>
                            <div className="flex-shrink-0 px-6 py-4" style={{ width: '16.66%' }}>
                              <span className="text-sm text-gray-500">{submission.processCategory || '-'}</span>
                            </div>
                            <div className="flex-shrink-0 px-6 py-4" style={{ width: '16.66%' }}>
                              <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                                {submission.statusText || status.label}
                              </span>
                            </div>
                            <div className="flex-shrink-0 px-6 py-4" style={{ width: '16.66%' }}>
                              <span className="text-sm text-gray-500">{new Date(displayTime).toLocaleString('zh-CN')}</span>
                            </div>
                            <div className="flex-shrink-0 px-6 py-4 text-right" style={{ width: '16.66%' }}>
                              <div className="flex items-center justify-end gap-3">
                                <button className="text-sm text-blue-600 hover:text-blue-800">
                                  <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} mr-1 text-xs`}></i>
                                  {isExpanded ? '收起' : '详情'}
                                </button>
                                {submission.canRestoreConversation ? (
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRestoreConversation(submission);
                                    }}
                                    disabled={restoringId === submission.id}
                                    className="text-sm text-sky-600 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {restoringId === submission.id ? '恢复中...' : '恢复对话'}
                                  </button>
                                ) : null}
                                {submission.status === 'submitted' ? (
                                  <button className="text-sm text-orange-600 hover:text-orange-800">催办</button>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {isExpanded ? (
                            <div className="border-t border-gray-100 bg-[linear-gradient(180deg,#fbfdff_0%,#f8fafc_100%)] px-6 py-5">
                              {renderSubmissionPreview(submission)}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {submissions.length === 0 ? (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
                  <i className="fas fa-file-alt text-2xl text-gray-400"></i>
                </div>
                <p className="mb-4 text-gray-500">暂无申请记录</p>
                <Link href="/chat" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700">
                  <i className="fas fa-plus"></i>
                  发起新申请
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
