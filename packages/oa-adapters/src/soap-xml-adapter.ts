import axios, { AxiosInstance } from 'axios';
import type {
  OAAdapter,
  DiscoverResult,
  HealthCheckResult,
  SubmitRequest,
  SubmitResult,
  StatusResult,
  ReferenceDataResult,
  CancelResult,
  UrgeResult,
} from './index';

/**
 * SoapXmlAdapter — 处理"SOAP/XML 接口"模式的适配器
 *
 * API 交互特征：
 *   1. 请求：Content-Type: text/xml，SOAP Envelope 包装
 *   2. 响应：XML 格式，需要解析 SOAP Body
 *   3. 认证：通常在 SOAP Header 中携带 WS-Security 或自定义 token
 *   4. WSDL：可通过 ?wsdl 发现服务端点
 *
 * 典型系统：泛微 Ecology（早期版本）、致远 A8、用友 NC、金蝶 EAS 等传统 Java EE 系统
 */

export interface SoapXmlConfig {
  baseUrl: string;
  /** WSDL 地址，用于服务发现 */
  wsdlUrl?: string;
  /** 认证方式 */
  authType?: 'ws-security' | 'soap-header' | 'basic';
  username?: string;
  password?: string;
  /** 自定义 SOAP Header XML 片段 */
  soapHeaderXml?: string;
  /** 命名空间 URI */
  namespace?: string;
  /** 提交操作名 */
  submitAction?: string;
  /** 查询操作名 */
  queryAction?: string;
  /** 取消操作名 */
  cancelAction?: string;
  /** 健康检查路径 */
  healthCheckPath?: string;
}

export class SoapXmlAdapter implements OAAdapter {
  private client: AxiosInstance;

  constructor(private config: SoapXmlConfig) {
    const headers: Record<string, string> = {
      'Content-Type': 'text/xml; charset=utf-8',
    };

    if (config.authType === 'basic' && config.username && config.password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    }

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers,
    });
  }

  async discover(): Promise<DiscoverResult> {
    const flows: DiscoverResult['discoveredFlows'] = [];

    if (this.config.wsdlUrl) {
      try {
        const response = await this.client.get(this.config.wsdlUrl, {
          headers: { 'Accept': 'text/xml' },
        });
        const wsdl = response.data as string;

        // 从 WSDL 中提取 operation 名称作为 flow
        const operationRegex = /<wsdl:operation\s+name="([^"]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = operationRegex.exec(wsdl)) !== null) {
          flows.push({
            flowCode: match[1],
            flowName: match[1],
          });
        }
      } catch {
        // WSDL 不可用时返回空
      }
    }

    return {
      oaVendor: 'SoapXml',
      oaVersion: '1.0',
      oaType: 'hybrid',
      authType: this.config.authType === 'basic' ? 'basic' : 'apikey',
      discoveredFlows: flows,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const path = this.config.healthCheckPath || this.config.wsdlUrl || '/';
      const response = await this.client.get(path, { timeout: 5000, validateStatus: () => true });
      return {
        healthy: response.status < 500,
        latencyMs: Date.now() - start,
        message: response.status < 500 ? 'OK' : `HTTP ${response.status}`,
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    const action = this.config.submitAction || 'submitWorkflow';
    const ns = this.config.namespace || 'http://workflow.service.oa';

    const dataFields = Object.entries(request.formData)
      .map(([k, v]) => `<${k}>${this.escapeXml(String(v))}</${k}>`)
      .join('');

    const envelope = this.buildEnvelope(`
      <ns:${action} xmlns:ns="${ns}">
        <flowCode>${this.escapeXml(request.flowCode)}</flowCode>
        <formData>${dataFields}</formData>
      </ns:${action}>
    `);

    try {
      const response = await this.client.post('', envelope, {
        headers: { SOAPAction: `"${ns}/${action}"` },
      });

      const body = response.data as string;
      const idMatch = body.match(/<(?:submissionId|workId|id)>([^<]+)<\//);
      const successMatch = body.match(/<(?:success|result)>(true|1|ok)<\//i);

      return {
        success: !!successMatch,
        submissionId: idMatch?.[1],
        metadata: { rawResponse: body.substring(0, 500) },
      };
    } catch (error: any) {
      return { success: false, errorMessage: this.extractSoapFault(error) };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    const action = this.config.queryAction || 'getWorkflowStatus';
    const ns = this.config.namespace || 'http://workflow.service.oa';

    const envelope = this.buildEnvelope(`
      <ns:${action} xmlns:ns="${ns}">
        <submissionId>${this.escapeXml(submissionId)}</submissionId>
      </ns:${action}>
    `);

    try {
      const response = await this.client.post('', envelope, {
        headers: { SOAPAction: `"${ns}/${action}"` },
      });

      const body = response.data as string;
      const statusMatch = body.match(/<(?:status|state)>([^<]+)<\//);

      return {
        status: statusMatch?.[1] || 'unknown',
        statusDetail: { rawResponse: body.substring(0, 500) },
      };
    } catch (error: any) {
      return { status: 'error', statusDetail: { error: this.extractSoapFault(error) } };
    }
  }

  async listReferenceData(_datasetCode: string): Promise<ReferenceDataResult> {
    throw new Error('Reference data sync not supported by SOAP adapter');
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    const action = this.config.cancelAction || 'cancelWorkflow';
    const ns = this.config.namespace || 'http://workflow.service.oa';

    const envelope = this.buildEnvelope(`
      <ns:${action} xmlns:ns="${ns}">
        <submissionId>${this.escapeXml(submissionId)}</submissionId>
      </ns:${action}>
    `);

    try {
      await this.client.post('', envelope, {
        headers: { SOAPAction: `"${ns}/${action}"` },
      });
      return { success: true, message: 'Cancelled via SOAP' };
    } catch (error: any) {
      return { success: false, message: this.extractSoapFault(error) };
    }
  }

  async urge(_submissionId: string): Promise<UrgeResult> {
    return { success: false, message: 'Urge not supported by SOAP adapter' };
  }

  // ── Private: SOAP helpers ─────────────────────────────────

  private buildEnvelope(body: string): string {
    const soapHeader = this.buildSoapHeader();
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  ${soapHeader ? `<soapenv:Header>${soapHeader}</soapenv:Header>` : ''}
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private buildSoapHeader(): string {
    if (this.config.soapHeaderXml) {
      return this.config.soapHeaderXml;
    }

    if (this.config.authType === 'ws-security' && this.config.username && this.config.password) {
      return `
<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <wsse:UsernameToken>
    <wsse:Username>${this.escapeXml(this.config.username)}</wsse:Username>
    <wsse:Password>${this.escapeXml(this.config.password)}</wsse:Password>
  </wsse:UsernameToken>
</wsse:Security>`;
    }

    if (this.config.authType === 'soap-header' && this.config.username && this.config.password) {
      return `
<auth:AuthHeader xmlns:auth="http://auth.service.oa">
  <auth:username>${this.escapeXml(this.config.username)}</auth:username>
  <auth:password>${this.escapeXml(this.config.password)}</auth:password>
</auth:AuthHeader>`;
    }

    return '';
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private extractSoapFault(error: any): string {
    const body = error?.response?.data;
    if (typeof body === 'string') {
      const faultMatch = body.match(/<faultstring>([^<]+)<\//);
      if (faultMatch) return faultMatch[1];
    }
    return error?.message || 'SOAP request failed';
  }
}
