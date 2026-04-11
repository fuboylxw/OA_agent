import type { AdapterConnectionConfig } from './index';
import type { AdapterDescriptor } from './registry';
import { CookieSessionAdapter } from './cookie-session-adapter';

/**
 * CookieSession Descriptor — 匹配使用 cookie session 认证的系统
 *
 * 匹配规则：
 *   - authType='cookie' + 有 loginPath  → 80
 *   - authType='cookie'                 → 60
 */
export const CookieSessionDescriptor: AdapterDescriptor = {
  id: 'cookie-session',
  name: 'Cookie Session Adapter',
  vendor: 'CookieSession',
  authTypes: ['cookie'],
  capabilities: {
    supportsDiscovery: true,
    supportsSubmit: true,
    supportsStatusQuery: true,
    supportsReferenceData: true,
    supportsCancel: true,
    supportsUrge: false,
    supportsDelegate: false,
    supportsSupplement: true,
    supportsWebhook: false,
  },

  match(config: AdapterConnectionConfig): number {
    const authConfig = config.authConfig || {};
    const loginPath = String(authConfig.loginPath || '');

    if (config.authType === 'cookie' && loginPath) return 80;
    if (config.authType === 'cookie') return 60;
    return 0;
  },

  create(config: AdapterConnectionConfig) {
    const authConfig = config.authConfig || {};
    return new CookieSessionAdapter({
      baseUrl: config.baseUrl,
      username: authConfig.username,
      password: authConfig.password,
      loginPath: authConfig.loginPath,
      healthCheckPath: authConfig.healthCheckPath,
      formsPath: authConfig.formsPath,
      submitPath: authConfig.submitPath,
      directoryPath: authConfig.directoryPath,
      flowCodeAliases: authConfig.flowCodeAliases,
      fieldMappings: authConfig.fieldMappings,
    }, config.flows || []);
  },
};
