'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AuthGuard from '../../components/AuthGuard';
import { apiClient } from '../../lib/api-client';

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function renderJson(value: unknown) {
  if (!value) return '-';
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs text-gray-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function BootstrapJobDetail() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.id) return;
    Promise.all([
      apiClient.get(`/bootstrap/jobs/${params.id}`),
      apiClient.get(`/bootstrap/jobs/${params.id}/report`).catch(() => ({ data: null })),
    ]).then(([jobRes, reportRes]) => {
      setJob(jobRes.data);
      setReport(reportRes.data);
    }).catch((err) => {
      setError(err.response?.status === 404 ? '任务不存在' : '加载失败');
    }).finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
          <p className="text-sm text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">{error || '任务不存在'}</p>
          <Link href="/bootstrap" className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-800">返回初始化中心</Link>
        </div>
      </div>
    );
  }

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Link href="/bootstrap" className="text-sm text-blue-600 hover:text-blue-800">
              返回初始化中心
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">
              {job.name || `初始化任务 ${job.id.slice(0, 8)}`}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              状态：{job.status} · 当前阶段：{job.currentStage || '-'} · 创建时间：{formatDate(job.createdAt)}
            </p>
          </div>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
            {job.status}
          </span>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">OA 地址</div>
            <div className="mt-2 break-all text-sm text-gray-900">{job.oaUrl || '-'}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">来源文档</div>
            <div className="mt-2 break-all text-sm text-gray-900">{job.openApiUrl || '-'}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">租户 ID</div>
            <div className="mt-2 break-all font-mono text-sm text-gray-900">{job.tenantId}</div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">队列令牌</div>
            <div className="mt-2 break-all font-mono text-xs text-gray-900">{job.queueJobId || '-'}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">阶段开始时间</div>
            <div className="mt-2 text-sm text-gray-900">{formatDate(job.stageStartedAt)}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">最近心跳</div>
            <div className="mt-2 text-sm text-gray-900">{formatDate(job.lastHeartbeatAt)}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">自动恢复计数</div>
            <div className="mt-2 text-sm text-gray-900">
              恢复 {job.recoveryAttemptCount || 0} 次 / 补齐 {job.reconcileAttemptCount || 0} 次
            </div>
          </div>
        </div>

        {job.stalledReason && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-medium">卡顿说明</div>
            <div className="mt-2 whitespace-pre-wrap break-words">{job.stalledReason}</div>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">任务明细</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">数据源</div>
              {job.sources?.length ? (
                <div className="space-y-3">
                  {job.sources.map((source: any) => (
                    <div key={source.id} className="rounded-lg bg-gray-50 p-4 text-sm">
                      <div className="font-medium text-gray-900">{source.sourceType}</div>
                      <div className="mt-1 break-all text-gray-600">{source.sourceUrl || '内嵌文档内容'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">暂无数据源</div>
              )}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">解析产物</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="text-xs text-gray-500">流程 IR</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">{job.flowIRs?.length || 0}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="text-xs text-gray-500">字段 IR</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">{job.fieldIRs?.length || 0}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="text-xs text-gray-500">规则 IR</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">{job.ruleIRs?.length || 0}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="text-xs text-gray-500">回放用例</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">{job.replayCases?.length || 0}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <div className="text-xs text-gray-500">自动修复尝试</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">{job.repairAttempts?.length || 0}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">最新报告</h2>
          {report ? renderJson(report) : <div className="text-sm text-gray-500">暂无报告</div>}
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">自动修复记录</h2>
          {job.repairAttempts?.length ? (
            <div className="space-y-3">
              {job.repairAttempts.map((attempt: any) => (
                <div key={attempt.id} className="rounded-lg bg-gray-50 p-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium text-gray-900">{attempt.flowCode}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">
                      第 {attempt.attemptNo} 次
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">
                      {attempt.status}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(attempt.createdAt)}</span>
                  </div>
                  {attempt.errorMessage && (
                    <div className="mt-2 text-sm text-red-600">{attempt.errorMessage}</div>
                  )}
                  {attempt.proposedPatch && (
                    <div className="mt-3">{renderJson(attempt.proposedPatch)}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">暂无自动修复记录</div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">原始任务数据</h2>
          {renderJson(job)}
        </div>
      </div>
    </main>
  );
}

export default function BootstrapJobDetailPage() {
  return (
    <AuthGuard allowedRoles={['admin']}>
      <BootstrapJobDetail />
    </AuthGuard>
  );
}
