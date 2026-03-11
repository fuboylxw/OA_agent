import type { AdapterConnectionConfig } from './index';
import type { AdapterDescriptor } from './registry';
import { TokenHeaderAdapter } from './token-header-adapter';

/**
 * TokenHeader Descriptor — 匹配使用自定义 header 传 token 的系统
 *
 * 匹配规则：
 *   - vendor 包含 'o2oa'              → 90
 *   - baseUrl 包含 '/x_desktop'       → 80
 *   - authConfig.headerName 是自定义值 → 70
 *   - authType='apikey' 且有 token    → 20
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
    const vendor = (config.oaVendor || '').toLowerCase();
    const authConfig = config.authConfig || {};
    const headerName = String(authConfig.headerName || '').toLowerCase();

    if (vendor.includes('o2oa')) return 90;
    if (config.baseUrl.includes('/x_desktop')) return 80;
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
