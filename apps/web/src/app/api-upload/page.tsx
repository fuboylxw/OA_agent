'use client';

import { useEffect, useState } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

export default function ApiUploadPage() {
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
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedTenantId = localStorage.getItem('tenantId') || '';
    setTenantId(storedTenantId);
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setConnectors([]);
      setConnectorId('');
      setError(null);
      return;
    }

    void fetchConnectors(tenantId);
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

  const fetchConnectors = async (currentTenantId: string) => {
    setLoadingConnectors(true);

    try {
      setError(null);
      const response = await fetch(
        `${API_URL}/api/v1/connectors?tenantId=${encodeURIComponent(currentTenantId)}`,
      );

      if (!response.ok) {
        throw new Error('连接器加载失败');
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
      setError(err.message || '连接器加载失败');
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
      setError('请选择文件');
      return;
    }

    if (!tenantId) {
      setError('请输入租户 ID');
      return;
    }

    if (!connectorId) {
      setError('请选择连接器');
      return;
    }

    if (!oaUrl) {
      setError('请输入OA系统URL');
      return;
    }

    let parsedAuthConfig = {};
    try {
      parsedAuthConfig = authConfig ? JSON.parse(authConfig) : {};
    } catch {
      setError('认证配置不是合法 JSON');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tenantId', tenantId);
      formData.append('connectorId', connectorId);
      formData.append('docType', docType);
      formData.append('oaUrl', oaUrl);
      formData.append('authConfig', JSON.stringify({
        type: authType,
        ...parsedAuthConfig,
      }));
      formData.append('autoValidate', autoValidate.toString());
      formData.append('autoGenerateMcp', autoGenerateMcp.toString());

      const response = await fetch(`${API_URL}/api/v1/mcp/upload-api`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || '上传失败');
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">API文件上传</h1>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">上传API文档</h2>

        <div className="space-y-4">
          {/* 文件选择 */}
          <div>
            <label className="block text-sm font-medium mb-2">选择API文档文件</label>
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".json,.yaml,.yml"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
              {file && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <FileText className="w-4 h-4" />
                  {file.name}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">租户 ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="请输入租户 ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">连接器</label>
              <button
                type="button"
                onClick={() => void fetchConnectors(tenantId)}
                disabled={!tenantId || loadingConnectors}
                className="text-sm text-blue-600 disabled:text-gray-400"
              >
                {loadingConnectors ? '加载中...' : '刷新列表'}
              </button>
            </div>
            <select
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              disabled={!tenantId || loadingConnectors || connectors.length === 0}
              className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
            >
              <option value="">
                {tenantId ? '请选择连接器' : '请先输入租户 ID'}
              </option>
              {connectors.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name}
                  {connector.status !== 'active' ? '（停用）' : ''}
                </option>
              ))}
            </select>
            {tenantId && !loadingConnectors && connectors.length === 0 && (
              <p className="mt-2 text-sm text-amber-600">当前租户下没有可用连接器。</p>
            )}
          </div>

          {/* 文档类型 */}
          <div>
            <label className="block text-sm font-medium mb-2">文档类型</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="openapi">OpenAPI 3.0</option>
              <option value="swagger">Swagger 2.0</option>
              <option value="postman">Postman Collection</option>
              <option value="custom">自定义格式</option>
            </select>
          </div>

          {/* OA系统URL */}
          <div>
            <label className="block text-sm font-medium mb-2">OA系统URL</label>
            <input
              type="url"
              value={oaUrl}
              onChange={(e) => setOaUrl(e.target.value)}
              placeholder="https://oa.example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          {/* 认证配置 */}
          <div>
            <label className="block text-sm font-medium mb-2">认证类型</label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
            >
              <option value="apikey">API Key</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
              <option value="oauth2">OAuth 2.0</option>
            </select>
            <textarea
              value={authConfig}
              onChange={(e) => setAuthConfig(e.target.value)}
              placeholder='{"apiKey": "your-api-key"} 或 {"token": "your-token"}'
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
            />
          </div>

          {/* 选项 */}
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoValidate}
                onChange={(e) => setAutoValidate(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">自动验证接口可访问性</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoGenerateMcp}
                onChange={(e) => setAutoGenerateMcp(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">自动生成MCP工具</span>
            </label>
          </div>

          {/* 上传按钮 */}
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                上传并处理
              </>
            )}
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* 处理结果 */}
      {result && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">处理结果</h2>

          {/* 统计信息 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{result.totalEndpoints}</div>
              <div className="text-sm text-gray-600">总接口数</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{result.workflowEndpoints}</div>
              <div className="text-sm text-gray-600">办事流程接口</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{result.validatedEndpoints}</div>
              <div className="text-sm text-gray-600">验证通过</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">{result.generatedMcpTools}</div>
              <div className="text-sm text-gray-600">生成MCP工具</div>
            </div>
          </div>

          {/* 办事流程接口列表 */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">识别的办事流程接口</h3>
            <div className="space-y-2">
              {result.workflowApis.map((api, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                          {api.method}
                        </span>
                        <span className="font-mono text-sm">{api.path}</span>
                      </div>
                      <div className="text-sm text-gray-600 mb-2">{api.description}</div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>类型: {api.workflowCategory}</span>
                        <span>置信度: {(api.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    {result.validationResults.find(
                      (v) => v.path === api.path && v.method === api.method
                    )?.isAccessible ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 生成的MCP工具 */}
          {result.mcpTools.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">生成的MCP工具</h3>
              <div className="space-y-2">
                {result.mcpTools.map((tool, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold">{tool.toolName}</span>
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
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
