import type { AdapterConnectionConfig } from './index';
import type { AdapterDescriptor } from './registry';
import { TokenHeaderAdapter } from './token-header-adapter';

/**
 * TokenHeader Descriptor — 匹配使用自定义 header 传 token 的系统
 *
 * 匹配规则：
 *   - authConfig.headerName 是非标准值（非 Authorization） → 70
 *   - authType='apikey' 且有 token 且有 headerName          → 20
 */
export const TokenHeaderDescriptor: AdapterDescriptor = {
  id: 'token-header',
  name: 'Token Header Adapter',
  vendor: 'TokenHeader',
  authTypes: ['apikey'],
  capabilities: {
    supportsDiscovery: true,
    supportsSubmit: true,
    supportsStatusQuery: true,
    supportsReferenceData: true,
    supportsCancel: true,
    supportsUrge: true,
    supportsDelegate: false,
    supportsSupplement: false,
    supportsWebhook: false,
  },

  match(config: AdapterConnectionConfig): number {
    const authConfig = config.authConfig || {};
    const headerName = String(authConfig.headerName || '').toLowerCase();

    if (headerName && headerName !== 'authorization' && authConfig.token) return 70;
    if (config.authType === 'apikey' && authConfig.token && headerName) return 20;
    return 0;
  },

  create(config: AdapterConnectionConfig) {
    const authConfig = config.authConfig || {};
    return new TokenHeaderAdapter({
      baseUrl: config.baseUrl,
      token: authConfig.token || authConfig.apiKey,
      credential: authConfig.credential || authConfig.username,
      password: authConfig.password,
      tokenHeader: authConfig.headerName,
      loginPath: authConfig.loginPath,
    });
  },
};
