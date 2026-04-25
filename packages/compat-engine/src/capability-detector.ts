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
          const purpose = readExplicitFormPurpose(form);
          result.detectedForms.push({
            url: form.action,
            fields: form.fields.map(f => ({ ...f })),
            purpose,
            confidence: purpose === 'unknown' ? 0.2 : 0.8,
          });
          if (purpose === 'submit') {
            result.canSubmit = true;
          }
        }
      }
    }
  }

  return result;
}

function analyzeEndpoint(path: string, method: string, spec: Record<string, any>): DetectedEndpoint | null {
  const purpose = readExplicitEndpointPurpose(spec);
  const confidence = purpose === 'unknown' ? 0 : 0.9;

  if (purpose === 'unknown') return null;

  return { path, method: method.toUpperCase(), purpose, confidence };
}

function analyzeHarEntry(entry: HarEntry): DetectedEndpoint | null {
  return null;
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

function readExplicitEndpointPurpose(spec: Record<string, any>): string {
  const value = spec['x-uniflow-purpose']
    || spec['x-oa-purpose']
    || spec['x-purpose']
    || spec['x-capability']
    || spec.purpose
    || spec.category;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  return normalized;
}

function readExplicitFormPurpose(form: FormInfo & Record<string, any>): string {
  const value = form.purpose || form.category || form['x-uniflow-purpose'] || form['x-oa-purpose'];
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  return normalized;
}
