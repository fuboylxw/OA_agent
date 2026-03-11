'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const STATUS_MAP: Record<string, { label: string; bgClass: string; textClass: string }> = {
  pending: { label: '待处理', bgClass: 'bg-orange-100', textClass: 'text-orange-600' },
  submitted: { label: '已提交', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  approved: { label: '已通过', bgClass: 'bg-green-100', textClass: 'text-green-600' },
  rejected: { label: '已驳回', bgClass: 'bg-red-100', textClass: 'text-red-600' },
  failed: { label: '失败', bgClass: 'bg-red-100', textClass: 'text-red-600' },
  cancelled: { label: '已撤回', bgClass: 'bg-gray-100', textClass: 'text-gray-600' },
};

interface FieldWithLabel {
  key: string;
  label: string;
  value: any;
  displayValue: any;
  type: string;
}

interface Submission {
  id: string;
  oaSubmissionId?: string;
  processCode?: string;
  processName?: string;
  processCategory?: string;
  status: string;
  statusText?: string;
  formData: Record<string, any>;
  formDataWithLabels?: FieldWithLabel[];
  user?: { id: string; username: string; displayName: string };
  submittedAt?: string;
  createdAt: string;
}

export default function SubmissionsContent({
  initialSubmissions,
  tenantId,
  userId,
}: {
  initialSubmissions: Submission[];
  tenantId: string;
  userId: string;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getStatus = (status: string) => STATUS_MAP[status] || { label: status, bgClass: 'bg-blue-100', textClass: 'text-blue-600' };
  const toggleExpand = (id: string) => setExpandedId(expandedId === id ? null : id);

  useEffect(() => {
    if (!tenantId || !userId) return undefined;

    let cancelled = false;

    const refreshSubmissions = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/v1/submissions?tenantId=${encodeURIComponent(tenantId)}&userId=${encodeURIComponent(userId)}`,
          { cache: 'no-store' },
        );
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
    }, 15000);

    void refreshSubmissions();
    window.addEventListener('focus', handleVisibleRefresh);
    document.addEventListener('visibilitychange', handleVisibleRefresh);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibleRefresh);
      document.removeEventListener('visibilitychange', handleVisibleRefresh);
    };
  }, [tenantId, userId]);

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">我的申请</h1>
            <p className="text-gray-600">查看和管理您提交的所有申请</p>
          </div>
          <a href="/chat" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
            <i className="fas fa-plus"></i>
            发起新申请
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">全部申请</p>
              <p className="text-2xl font-bold text-gray-900">{submissions.length}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-file-alt text-blue-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">待处理</p>
              <p className="text-2xl font-bold text-orange-600">
                {submissions.filter((s) => s.status === 'pending' || s.status === 'submitted').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-clock text-orange-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">已通过</p>
              <p className="text-2xl font-bold text-green-600">
                {submissions.filter((s) => s.status === 'approved').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-check-circle text-green-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">已驳回</p>
              <p className="text-2xl font-bold text-red-600">
                {submissions.filter((s) => s.status === 'rejected' || s.status === 'failed').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-times-circle text-red-600"></i>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">申请编号</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">流程名称</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">分类</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">提交时间</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => {
                const status = getStatus(submission.status);
                const isExpanded = expandedId === submission.id;
                return (
                  <tr key={submission.id} className="border-b border-gray-200">
                    <td colSpan={6} className="p-0">
                      <div
                        className="flex items-center hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => toggleExpand(submission.id)}
                      >
                        <div className="px-6 py-4 flex-shrink-0" style={{ width: '16.66%' }}>
                          <span className="text-sm font-mono text-gray-500">
                            {submission.oaSubmissionId || submission.id.substring(0, 8)}
                          </span>
                        </div>
                        <div className="px-6 py-4 flex-shrink-0" style={{ width: '16.66%' }}>
                          <span className="text-sm font-medium text-gray-900">
                            {submission.processName || '未知流程'}
                          </span>
                        </div>
                        <div className="px-6 py-4 flex-shrink-0" style={{ width: '16.66%' }}>
                          <span className="text-sm text-gray-500">
                            {submission.processCategory || '-'}
                          </span>
                        </div>
                        <div className="px-6 py-4 flex-shrink-0" style={{ width: '16.66%' }}>
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                            {submission.statusText || status.label}
                          </span>
                        </div>
                        <div className="px-6 py-4 flex-shrink-0" style={{ width: '16.66%' }}>
                          <span className="text-sm text-gray-500">
                            {new Date(submission.submittedAt || submission.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <div className="px-6 py-4 flex-shrink-0 text-right" style={{ width: '16.66%' }}>
                          <div className="flex items-center justify-end gap-3">
                            <button className="text-sm text-blue-600 hover:text-blue-800">
                              <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'} text-xs mr-1`}></i>
                              {isExpanded ? '收起' : '详情'}
                            </button>
                            {submission.status === 'submitted' && (
                              <button className="text-sm text-orange-600 hover:text-orange-800">催办</button>
                            )}
                          </div>
                        </div>
                      </div>

                      {isExpanded && submission.formDataWithLabels && (
                        <div className="px-6 pb-4 bg-gray-50 border-t border-gray-100">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-3">
                            {submission.formDataWithLabels.map((field) => (
                              <div key={field.key} className="flex items-start gap-2">
                                <span className="text-sm text-gray-500 flex-shrink-0 min-w-[80px]">{field.label}：</span>
                                <span className="text-sm text-gray-900">{String(field.displayValue)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {submissions.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-file-alt text-gray-400 text-2xl"></i>
            </div>
            <p className="text-gray-500 mb-4">暂无申请记录</p>
            <a href="/chat" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
              <i className="fas fa-plus"></i>
              发起新申请
            </a>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
