import type { AdapterConnectionConfig } from './index';
import type { AdapterDescriptor } from './registry';
import { SoapXmlAdapter } from './soap-xml-adapter';

/**
 * SoapXml Descriptor — 匹配使用 SOAP/XML 接口的系统
 *
 * 匹配规则：
 *   - authConfig 中有 wsdlUrl                    → 90
 *   - authConfig 中有 soapHeaderXml/soapAuthType → 70
 */
export const SoapXmlDescriptor: AdapterDescriptor = {
  id: 'soap-xml',
  name: 'SOAP/XML Adapter',
  vendor: 'SoapXml',
  authTypes: ['basic', 'apikey'],
  capabilities: {
    supportsDiscovery: true,
    supportsSubmit: true,
    supportsStatusQuery: true,
    supportsReferenceData: false,
    supportsCancel: true,
    supportsUrge: false,
    supportsDelegate: false,
    supportsSupplement: false,
    supportsWebhook: false,
  },

  match(config: AdapterConnectionConfig): number {
    const authConfig = config.authConfig || {};

    if (authConfig.wsdlUrl) return 90;
    if (authConfig.soapHeaderXml || authConfig.soapAuthType) return 70;
    return 0;
  },

  create(config: AdapterConnectionConfig) {
    const authConfig = config.authConfig || {};
    return new SoapXmlAdapter({
      baseUrl: config.baseUrl,
      wsdlUrl: authConfig.wsdlUrl,
      authType: authConfig.soapAuthType || (config.authType === 'basic' ? 'basic' : 'soap-header'),
      username: authConfig.username,
      password: authConfig.password,
      soapHeaderXml: authConfig.soapHeaderXml,
      namespace: authConfig.namespace,
      submitAction: authConfig.submitAction,
      queryAction: authConfig.queryAction,
      cancelAction: authConfig.cancelAction,
      healthCheckPath: authConfig.healthCheckPath,
    });
  },
};
