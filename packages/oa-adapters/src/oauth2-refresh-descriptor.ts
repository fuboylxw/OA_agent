import type { AdapterConnectionConfig } from './index';
import type { AdapterDescriptor } from './registry';
import { OAuth2RefreshAdapter } from './oauth2-refresh-adapter';

/**
 * OAuth2Refresh Descriptor — 匹配使用 OAuth2 Bearer + 自动刷新 token 的系统
 *
 * 匹配规则：
 *   - vendor 包含 'dingtalk'/'钉钉'/'feishu'/'飞书'/'wecom'/'企业微信' → 90
 *   - baseUrl 包含 dingtalk/feishu/wecom 域名                          → 85
 *   - authType='oauth2' 且有 appKey+appSecret                          → 70
 *   - authType='oauth2'                                                 → 30
 */
export const OAuth2RefreshDescriptor: AdapterDescriptor = {
  id: 'oauth2-refresh',
  name: 'OAuth2 Auto-Refresh Adapter',
  vendor: 'OAuth2Refresh',
  authTypes: ['oauth2'],
  capabilities: {
    supportsDiscovery: true,
    supportsSubmit: true,
    supportsStatusQuery: true,
    supportsReferenceData: true,
    supportsCancel: false,
    supportsUrge: true,
    supportsDelegate: false,
    supportsSupplement: false,
    supportsWebhook: true,
  },

  match(config: AdapterConnectionConfig): number {
    const vendor = (config.oaVendor || '').toLowerCase();
    const authConfig = config.authConfig || {};

    const knownVendors = ['dingtalk', '钉钉', 'feishu', '飞书', 'wecom', '企业微信', 'welink'];
    if (knownVendors.some(v => vendor.includes(v))) return 90;

    const knownDomains = ['dingtalk.com', 'feishu.cn', 'wecom.work', 'welink.huaweicloud'];
    if (knownDomains.some(d => config.baseUrl.includes(d))) return 85;

    if (config.authType === 'oauth2' && authConfig.appKey && authConfig.appSecret) return 70;
    if (config.authType === 'oauth2') return 30;
    return 0;
  },

  create(config: AdapterConnectionConfig) {
    const authConfig = config.authConfig || {};
    return new OAuth2RefreshAdapter({
      baseUrl: config.baseUrl,
      appKey: authConfig.appKey || authConfig.apiKey || '',
      appSecret: authConfig.appSecret || authConfig.secret || '',
      tokenPath: authConfig.tokenPath,
      tokenDelivery: authConfig.tokenDelivery,
      tokenQueryParam: authConfig.tokenQueryParam,
      processListPath: authConfig.processListPath,
      submitPath: authConfig.submitPath,
      queryPath: authConfig.queryPath,
      departmentListPath: authConfig.departmentListPath,
      healthCheckPath: authConfig.healthCheckPath,
      successCode: authConfig.successCode,
      errorCodeField: authConfig.errorCodeField,
      errorMsgField: authConfig.errorMsgField,
    });
  },
};
