'use client';

import { useEffect, useState } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { authFetch } from '../lib/api-client';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { getClientUserInfo, hasClientSession } from '../lib/client-auth';
import AuthGuard from '../components/AuthGuard';

interface ConnectorOption {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
}

interface UploadResult {
  uploadId: string;
  totalEndpoints: number;
  workflowEndpoints: number;
  validatedEndpoints: number;
  generatedMcpTools: number;
  workflowApis: any[];
  validationResults: any[];
  mcpTools: any[];
}

interface RepairSummary {
  attemptCount: number;
  accepted: boolean;
}

interface UploadAttempt {
  id: string;
  attemptNo: number;
  stage: string;
  strategy: string;
  parseSuccess: boolean;
  endpointCount: number;
  workflowCount: number;
  validationScore?: number | null;
  decision: string;
  errorType?: string | null;
  errorMessage?: string | null;
  diagnostics?: {
    parseErrors?: string[];
    schemaErrors?: string[];
    missingFields?: string[];
    suspiciousSections?: string[];
  } | null;
  repairActions?: Array<{
    action: string;
    reason: string;
    applied: boolean;
  }> | null;
}

interface UploadJob {
  id: string;
  status: string;
  sourceName?: string | null;
  docType: string;
  currentAttemptNo: number;
  finalDecision?: string | null;
  finalErrorType?: string | null;
  finalErrorMessage?: string | null;
  acceptedEndpointCount?: number | null;
  acceptedWorkflowCount?: number | null;
  acceptedValidationScore?: number | null;
  uploadResult?: UploadResult | null;
  attempts: UploadAttempt[];
  repairSummary?: RepairSummary;
}

const TERMINAL_JOB_STATUSES = new Set(['SUCCEEDED', 'FAILED']);
const JOB_STATUS_LABELS: Record<string, string> = {
  CREATED: '已创建',
  QUEUED: '排队中',
  RUNNING: '处理中',
  PARSING: '解析中',
  ANALYZING: '分析中',
  VALIDATING: '校验中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
};

const ATTEMPT_DECISION_LABELS: Record<string, string> = {
  accepted: '已采纳',
  rejected: '已拒绝',
  retry: '待重试',
  failed: '失败',
};

const ATTEMPT_STAGE_LABELS: Record<string, string> = {
  uploaded: '已上传',
  parsing: '解析中',
  repairing: '修复中',
  validating: '校验中',
  finalized: '已完成',
};

const ATTEMPT_STRATEGY_LABELS: Record<string, string> = {
  baseline: '基础解析',
  schema_repair: '结构修复',
  response_repair: '响应修复',
  endpoint_repair: '端点修复',
  llm_repair: '智能修复',
};

function isTerminalStatus(status?: string | null) {
  return Boolean(status && TERMINAL_JOB_STATUSES.has(status));
}

function formatStatus(status?: string | null) {
  if (!status) return '-';
  return JOB_STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

function formatAttemptDecision(decision?: string | null) {
  if (!decision) return '-';
  return ATTEMPT_DECISION_LABELS[decision] || decision;
}

function formatAttemptStage(stage?: string | null) {
  if (!stage) return '-';
  return ATTEMPT_STAGE_LABELS[stage] || stage.replace(/_/g, ' ');
}

function formatAttemptStrategy(strategy?: string | null) {
  if (!strategy) return '-';
  return ATTEMPT_STRATEGY_LABELS[strategy] || strategy.replace(/_/g, ' ');
}

function formatConnectorStatus(status?: string | null) {
  if (!status) return '';
  if (status === 'active') return '启用中';
  if (status === 'inactive') return '未启用';
  return status;
}

function formatScore(score?: number | null) {
  if (typeof score !== 'number') {
    return '-';
  }
  return `${Math.round(score * 100)}%`;
}

function ApiUploadContent() {
  const [file, setFile] = useState<File | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [docType, setDocType] = useState<'openapi' | 'swagger' | 'postman' | 'custom'>('openapi');
  const [oaUrl, setOaUrl] = useState('');
  const [authType, setAuthType] = useState('apikey');
  const [authConfig, setAuthConfig] = useState('');
  const [autoValidate, setAutoValidate] = useState(true);
  const [autoGenerateMcp, setAutoGenerateMcp] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loadingConnectors, setLoadingConnectors] = useState(false);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedTenantId = getClientUserInfo().tenantId || '';
    setTenantId(storedTenantId);
  }, []);

  useEffect(() => {
    if (!tenantId || !hasClientSession()) {
      setConnectors([]);
      setConnectorId('');
      setError(null);
      return;
    }

    void fetchConnectors();
  }, [tenantId]);

  useEffect(() => {
    if (!connectorId || oaUrl) {
      return;
    }

    const connector = connectors.find((item) => item.id === connectorId);
    if (connector?.baseUrl) {
      setOaUrl(connector.baseUrl);
    }
  }, [connectorId, connectors, oaUrl]);

  useEffect(() => {
    if (!pollingJobId || !tenantId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollJob = async () => {
      try {
        const response = await authFetch(
          withBrowserApiBase(
            `/api/v1/mcp/upload-api-job/${pollingJobId}?tenantId=${encodeURIComponent(tenantId)}`,
          ),
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.message || '加载上传任务失败');
        }

        const data = await response.json() as UploadJob;
        if (cancelled) {
          return;
        }

        setJob(data);
        setResult(data.uploadResult || null);

        if (isTerminalStatus(data.status)) {
          setUploading(false);
          setPollingJobId(null);
          if (data.status === 'FAILED') {
            setError(data.finalErrorMessage || '上传失败');
          }
          return;
        }

        timer = setTimeout(() => {
          void pollJob();
        }, 1500);
      } catch (err: any) {
        if (cancelled) {
          return;
        }
        setUploading(false);
        setPollingJobId(null);
        setError(err.message || '轮询上传任务失败');
      }
    };

    void pollJob();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [pollingJobId, tenantId]);

  const fetchConnectors = async () => {
    setLoadingConnectors(true);

    try {
      setError(null);
      const response = await authFetch(withBrowserApiBase('/api/v1/connectors'));

      if (!response.ok) {
        throw new Error('加载连接器失败');
      }

      const data = await response.json();
      const connectorList = Array.isArray(data) ? data : [];

      setConnectors(connectorList);
      setConnectorId((currentConnectorId) => {
        if (connectorList.some((item) => item.id === currentConnectorId)) {
          return currentConnectorId;
        }
        return connectorList[0]?.id || '';
      });
    } catch (err: any) {
      setConnectors([]);
      setConnectorId('');
      setError(err.message || '加载连接器失败');
    } finally {
      setLoadingConnectors(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('请选择文档文件');
      return;
    }

    if (!hasClientSession()) {
      setError('登录状态已失效，请重新登录');
      return;
    }

    if (!connectorId) {
      setError('请选择连接器');
      return;
    }

    if (!oaUrl) {
      setError('请输入 OA 地址');
      return;
    }

    let parsedAuthConfig = {};
    try {
      parsedAuthConfig = authConfig ? JSON.parse(authConfig) : {};
    } catch {
      setError('认证配置必须是合法的 JSON');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);
    setJob(null);
    setPollingJobId(null);

    try {
      const docContent = await file.text();
      const response = await authFetch(withBrowserApiBase('/api/v1/mcp/upload-api-job'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          connectorId,
          sourceName: file.name,
          docType,
          docContent,
          oaUrl,
          authConfig: {
            type: authType,
            ...parsedAuthConfig,
          },
          autoValidate,
          autoGenerateMcp,
          maxRepairAttempts: 4,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || '上传失败');
      }

      const data = await response.json() as UploadJob;
      setJob(data);
      setResult(data.uploadResult || null);

      if (isTerminalStatus(data.status)) {
        setUploading(false);
        if (data.status === 'FAILED') {
          setError(data.finalErrorMessage || '上传失败');
        }
        return;
      }

      setPollingJobId(data.id);
    } catch (err: any) {
      setUploading(false);
      setPollingJobId(null);
      setError(err.message || '上传失败');
    }
  };

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <h1 className="mb-6 text-3xl font-bold">接口文档上传</h1>

      <div className="mb-6 rounded-lg bg-white p-6 shadow-md">
        <h2 className="mb-4 text-xl font-semibold">创建上传任务</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">接口文档文件（JSON）</label>
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
              />
              {file && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <FileText className="h-4 w-4" />
                  {file.name}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">租户 ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="请输入租户 ID"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium">连接器</label>
              <button
                type="button"
                onClick={() => void fetchConnectors()}
                disabled={loadingConnectors}
                className="text-sm text-blue-600 disabled:text-gray-400"
              >
                {loadingConnectors ? '加载中...' : '刷新'}
              </button>
            </div>
            <select
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              disabled={loadingConnectors || connectors.length === 0}
              className="w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
            >
              <option value="">
                {tenantId ? '请选择连接器' : '请先填写租户 ID'}
              </option>
              {connectors.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name}
                  {connector.status !== 'active' ? `（${formatConnectorStatus(connector.status)}）` : ''}
                </option>
              ))}
            </select>
            {!loadingConnectors && connectors.length === 0 && (
              <p className="mt-2 text-sm text-amber-600">
                当前租户下没有可用连接器。
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">文档类型</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as typeof docType)}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="openapi">OpenAPI 3.0 文档</option>
              <option value="swagger">Swagger 2.0 文档</option>
              <option value="postman">Postman 集合</option>
              <option value="custom">自定义文档</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">OA 地址</label>
            <input
              type="url"
              value={oaUrl}
              onChange={(e) => setOaUrl(e.target.value)}
              placeholder="https://oa.example.com"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">认证方式</label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="apikey">API 密钥</option>
              <option value="bearer">Bearer 令牌</option>
              <option value="basic">基础认证</option>
              <option value="oauth2">OAuth 2.0</option>
            </select>
            <textarea
              value={authConfig}
              onChange={(e) => setAuthConfig(e.target.value)}
              placeholder='{"apiKey":"请输入密钥"}'
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoValidate}
                onChange={(e) => setAutoValidate(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm">自动校验工作流端点</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoGenerateMcp}
                onChange={(e) => setAutoGenerateMcp(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm">自动生成 MCP 工具</span>
            </label>
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {uploading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                正在执行自动修复循环...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                创建上传任务
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}
      </div>

      {job && (
        <div className="mb-6 rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">修复任务</h2>
              <p className="text-sm text-gray-500">
                任务 ID：<span className="font-mono">{job.id}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {job.status === 'SUCCEEDED' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : job.status === 'FAILED' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              )}
              <span className="text-sm font-medium">{formatStatus(job.status)}</span>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs uppercase text-gray-500">尝试次数</div>
              <div className="text-2xl font-bold text-slate-700">
                {job.repairSummary?.attemptCount ?? job.attempts.length}
              </div>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="text-xs uppercase text-gray-500">采纳端点数</div>
              <div className="text-2xl font-bold text-blue-600">
                {job.acceptedEndpointCount ?? 0}
              </div>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <div className="text-xs uppercase text-gray-500">工作流端点数</div>
              <div className="text-2xl font-bold text-green-600">
                {job.acceptedWorkflowCount ?? 0}
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <div className="text-xs uppercase text-gray-500">校验得分</div>
              <div className="text-2xl font-bold text-amber-600">
                {formatScore(job.acceptedValidationScore)}
              </div>
            </div>
          </div>

          {job.finalErrorMessage && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {job.finalErrorMessage}
            </div>
          )}

          <div>
            <h3 className="mb-3 text-lg font-semibold">修复尝试</h3>
            <div className="space-y-3">
              {job.attempts.length === 0 && (
                <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                  正在等待第一次修复尝试...
                </div>
              )}

              {job.attempts.map((attempt) => (
                <div key={attempt.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        第 {attempt.attemptNo} 次
                      </span>
                      <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                        {formatAttemptStrategy(attempt.strategy)}
                      </span>
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                        {formatAttemptStage(attempt.stage)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {attempt.decision === 'accepted' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-amber-500" />
                      )}
                      <span>{formatAttemptDecision(attempt.decision)}</span>
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div>
                      <div className="text-gray-500">解析</div>
                      <div className={attempt.parseSuccess ? 'text-green-600' : 'text-red-600'}>
                        {attempt.parseSuccess ? '成功' : '失败'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">端点数</div>
                      <div>{attempt.endpointCount}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">工作流</div>
                      <div>{attempt.workflowCount}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">得分</div>
                      <div>{formatScore(attempt.validationScore)}</div>
                    </div>
                  </div>

                  {Array.isArray(attempt.repairActions) && attempt.repairActions.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-2 text-sm font-medium">修复动作</div>
                      <div className="space-y-2">
                        {attempt.repairActions.map((action, index) => (
                          <div
                            key={`${attempt.id}-${action.action}-${index}`}
                            className="rounded-md bg-slate-50 p-3 text-sm"
                          >
                            <div className="font-medium">
                              {action.action}
                              {action.applied ? '：已应用' : '：已跳过'}
                            </div>
                            <div className="text-gray-600">{action.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(attempt.errorMessage || attempt.diagnostics) && (
                    <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
                      {attempt.errorMessage && <div>{attempt.errorMessage}</div>}
                      {attempt.diagnostics?.missingFields?.length ? (
                        <div>缺失字段：{attempt.diagnostics.missingFields.join(', ')}</div>
                      ) : null}
                      {attempt.diagnostics?.schemaErrors?.length ? (
                        <div>结构错误：{attempt.diagnostics.schemaErrors.join(', ')}</div>
                      ) : null}
                      {attempt.diagnostics?.suspiciousSections?.length ? (
                        <div>可疑片段：{attempt.diagnostics.suspiciousSections.join(', ')}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg bg-white p-6 shadow-md">
          <h2 className="mb-4 text-xl font-semibold">上传结果</h2>

          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="text-2xl font-bold text-blue-600">{result.totalEndpoints}</div>
              <div className="text-sm text-gray-600">总端点数</div>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <div className="text-2xl font-bold text-green-600">{result.workflowEndpoints}</div>
              <div className="text-sm text-gray-600">工作流端点数</div>
            </div>
            <div className="rounded-lg bg-yellow-50 p-4">
              <div className="text-2xl font-bold text-yellow-600">{result.validatedEndpoints}</div>
              <div className="text-sm text-gray-600">已校验</div>
            </div>
            <div className="rounded-lg bg-purple-50 p-4">
              <div className="text-2xl font-bold text-purple-600">{result.generatedMcpTools}</div>
              <div className="text-sm text-gray-600">生成的 MCP 工具</div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold">工作流接口</h3>
            <div className="space-y-2">
              {result.workflowApis.map((api, index) => (
                <div key={`${api.path}-${api.method}-${index}`} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                          {api.method}
                        </span>
                        <span className="font-mono text-sm">{api.path}</span>
                      </div>
                      <div className="mb-2 text-sm text-gray-600">{api.description}</div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>分类：{api.workflowCategory}</span>
                        <span>置信度：{Math.round((api.confidence || 0) * 100)}%</span>
                      </div>
                    </div>
                    {result.validationResults.find(
                      (item) => item.path === api.path && item.method === api.method,
                    )?.isAccessible ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {result.mcpTools.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold">生成的 MCP 工具</h3>
              <div className="space-y-2">
                {result.mcpTools.map((tool, index) => (
                  <div key={`${tool.toolName}-${index}`} className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-semibold">{tool.toolName}</span>
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                        {tool.category}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">{tool.toolDescription}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiUploadPage() {
  return (
    <AuthGuard allowedRoles={['admin', 'flow_manager']}>
      <ApiUploadContent />
    </AuthGuard>
  );
}
