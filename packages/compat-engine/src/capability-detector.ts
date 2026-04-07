import { OCLLevel } from '@uniflow/shared-types';

// ============================================================
// Capability Detector - Detects OA system capabilities
// ============================================================

export interface DetectionInput {
  openApiSpec?: Record<string, any>;
  harEntries?: HarEntry[];
  htmlPages?: HtmlPage[];
  probeResults?: ProbeResult[];
}

export interface HarEntry {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  responseStatus: number;
  responseBody?: string;
}

export interface HtmlPage {
  url: string;
  html: string;
  forms?: FormInfo[];
}

export interface FormInfo {
  action: string;
  method: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
}

export interface ProbeResult {
  endpoint: string;
  method: string;
  status: number;
  responseTime: number;
  hasAuth: boolean;
}

export interface DetectionResult {
  hasApi: boolean;
  hasOpenApi: boolean;
  hasAuth: boolean;
  canReadUsers: boolean;
  canReadFlows: boolean;
  canReadStatus: boolean;
  canSubmit: boolean;
  submitStable: boolean;
  hasCallback: boolean;
  hasRealtimePermission: boolean;
  hasIdempotent: boolean;
  canCancel: boolean;
  canUrge: boolean;
  canDelegate: boolean;
  canSupplement: boolean;
  detectedEndpoints: DetectedEndpoint[];
  detectedForms: DetectedForm[];
}

export interface DetectedEndpoint {
  path: string;
  method: string;
  purpose: string; // auth, list_flows, submit, query_status, etc.
  confidence: number;
}

export interface DetectedForm {
  url: string;
  fields: Array<{ name: string; type: string; required: boolean; label?: string }>;
  purpose: string;
  confidence: number;
}

export function detectCapabilities(input: DetectionInput): DetectionResult {
  const result: DetectionResult = {
    hasApi: false,
    hasOpenApi: false,
    hasAuth: false,
    canReadUsers: false,
    canReadFlows: false,
    canReadStatus: false,
    canSubmit: false,
    submitStable: false,
    hasCallback: false,
    hasRealtimePermission: false,
    hasIdempotent: false,
    canCancel: false,
    canUrge: false,
    canDelegate: false,
    canSupplement: false,
    detectedEndpoints: [],
    detectedForms: [],
  };

  // Detect from OpenAPI spec
  if (input.openApiSpec) {
    result.hasOpenApi = true;
    result.hasApi = true;
    const paths = input.openApiSpec.paths || {};
    for (const [path, methods] of Object.entries(paths)) {
      const methodObj = methods as Record<string, any>;
      for (const [method, spec] of Object.entries(methodObj)) {
        const endpoint = analyzeEndpoint(path, method, spec as Record<string, any>);
        if (endpoint) {
          result.detectedEndpoints.push(endpoint);
          applyEndpointCapability(result, endpoint);
        }
      }
    }
  }

  // Detect from HAR entries
  if (input.harEntries) {
    result.hasApi = true;
    for (const entry of input.harEntries) {
      if (entry.requestHeaders['authorization'] || entry.requestHeaders['cookie']) {
        result.hasAuth = true;
      }
      const endpoint = analyzeHarEntry(entry);
      if (endpoint) {
        result.detectedEndpoints.push(endpoint);
        applyEndpointCapability(result, endpoint);
      }
    }
  }

  // Detect from HTML pages
  if (input.htmlPages) {
    for (const page of input.htmlPages) {
      if (page.forms) {
        for (const form of page.forms) {
          result.detectedForms.push({
            url: form.action,
            fields: form.fields.map(f => ({ ...f })),
            purpose: guessFormPurpose(form),
            confidence: 0.6,
          });
          if (guessFormPurpose(form) === 'submit') {
            result.canSubmit = true;
          }
        }
      }
    }
  }

  return result;
}

function analyzeEndpoint(path: string, method: string, spec: Record<string, any>): DetectedEndpoint | null {
  const lowerPath = path.toLowerCase();
  const tags = (spec.tags || []).map((t: string) => t.toLowerCase());
  const summary = (spec.summary || '').toLowerCase();

  let purpose = 'unknown';
  let confidence = 0.5;

  if (lowerPath.includes('/auth') || lowerPath.includes('/login') || lowerPath.includes('/token')) {
    purpose = 'auth';
    confidence = 0.9;
  } else if (lowerPath.includes('/user') && method === 'get') {
    purpose = 'list_users';
    confidence = 0.8;
  } else if (lowerPath.includes('/status') || lowerPath.includes('/progress')) {
    purpose = 'query_status';
    confidence = 0.8;
  } else if ((lowerPath.includes('/flow') || lowerPath.includes('/process')) && method === 'get') {
    purpose = 'list_flows';
    confidence = 0.8;
  } else if (lowerPath.includes('/submit') || (lowerPath.includes('/application') && method === 'post')) {
    purpose = 'submit';
    confidence = 0.85;
  } else if (lowerPath.includes('/cancel') || lowerPath.includes('/revoke')) {
    purpose = 'cancel';
    confidence = 0.8;
  } else if (lowerPath.includes('/urge') || lowerPath.includes('/remind')) {
    purpose = 'urge';
    confidence = 0.7;
  } else if (lowerPath.includes('/delegate') || lowerPath.includes('/transfer')) {
    purpose = 'delegate';
    confidence = 0.7;
  } else if (lowerPath.includes('/supplement') || lowerPath.includes('/attach')) {
    purpose = 'supplement';
    confidence = 0.7;
  } else if (lowerPath.includes('/callback') || lowerPath.includes('/webhook')) {
    purpose = 'callback';
    confidence = 0.8;
  }

  if (purpose === 'unknown') return null;

  return { path, method: method.toUpperCase(), purpose, confidence };
}

function analyzeHarEntry(entry: HarEntry): DetectedEndpoint | null {
  const url = new URL(entry.url, 'http://localhost');
  return analyzeEndpoint(url.pathname, entry.method.toLowerCase(), {});
}

function applyEndpointCapability(result: DetectionResult, endpoint: DetectedEndpoint): void {
  switch (endpoint.purpose) {
    case 'auth': result.hasAuth = true; break;
    case 'list_users': result.canReadUsers = true; break;
    case 'list_flows': result.canReadFlows = true; break;
    case 'query_status': result.canReadStatus = true; break;
    case 'submit': result.canSubmit = true; break;
    case 'cancel': result.canCancel = true; break;
    case 'urge': result.canUrge = true; break;
    case 'delegate': result.canDelegate = true; break;
    case 'supplement': result.canSupplement = true; break;
    case 'callback': result.hasCallback = true; break;
  }
}

function guessFormPurpose(form: FormInfo): string {
  const action = form.action.toLowerCase();
  if (action.includes('login') || action.includes('auth')) return 'auth';
  if (action.includes('submit') || action.includes('apply')) return 'submit';
  if (action.includes('search') || action.includes('query')) return 'query';
  return 'unknown';
}
