import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { hostname } from 'os';
import { dirname, join, resolve } from 'path';

export type RuntimeDiagnosticCategory = 'llm' | 'system';
export type RuntimeDiagnosticLevel = 'info' | 'warn' | 'error';
export type RuntimeDiagnosticEventType =
  | 'llm_call'
  | 'llm_error'
  | 'audit_error'
  | 'runtime_error'
  | 'worker_error';

export interface RuntimeDiagnosticEvent {
  id: string;
  timestamp: string;
  source: string;
  category: RuntimeDiagnosticCategory;
  eventType: RuntimeDiagnosticEventType;
  level: RuntimeDiagnosticLevel;
  scope?: string;
  message?: string;
  traceId?: string;
  tenantId?: string;
  userId?: string;
  tags?: string[];
  data?: Record<string, any>;
  pid: number;
  hostname: string;
}

export interface RuntimeDiagnosticTraceContext {
  scope?: string;
  traceId?: string;
  tenantId?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ReadRuntimeDiagnosticQuery {
  source?: string;
  category?: RuntimeDiagnosticCategory;
  eventType?: RuntimeDiagnosticEventType;
  level?: RuntimeDiagnosticLevel;
  traceId?: string;
  tenantId?: string;
  search?: string;
  limit?: number;
}

const DEFAULT_MAX_STRING_LENGTH = parseInt(process.env.RUNTIME_DIAGNOSTICS_MAX_STRING_LENGTH || '6000', 10);
const DEFAULT_MAX_ITEMS = parseInt(process.env.RUNTIME_DIAGNOSTICS_MAX_ITEMS || '20', 10);
const PROCESS_HANDLER_MARK = Symbol.for('uniflow.runtime_diagnostics.process_handlers');

function getDiagnosticsFilePath() {
  if (process.env.RUNTIME_DIAGNOSTICS_FILE) {
    return resolve(process.env.RUNTIME_DIAGNOSTICS_FILE);
  }

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  return resolve(
    join(workspaceRoot, '.logs', 'current', 'diagnostics', 'runtime-diagnostics.jsonl'),
  );
}

function findWorkspaceRoot(startDir: string) {
  let currentDir = resolve(startDir);

  while (true) {
    if (existsSync(join(currentDir, 'pnpm-workspace.yaml')) || existsSync(join(currentDir, '.git'))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return resolve(startDir);
    }
    currentDir = parentDir;
  }
}

function detectSource() {
  return process.env.RUNTIME_DIAGNOSTICS_SOURCE
    || process.env.APP_RUNTIME
    || process.title
    || 'unknown';
}

function isSensitiveKey(key: string) {
  return /(password|passwd|secret|token|authorization|cookie|api[-_]?key|appsecret|appkey)/i.test(key);
}

function truncateString(value: string) {
  if (value.length <= DEFAULT_MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, DEFAULT_MAX_STRING_LENGTH)}...<truncated:${value.length - DEFAULT_MAX_STRING_LENGTH}>`;
}

function sanitizeValue(value: any, depth = 0, visited = new WeakSet<object>()): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (depth >= 4) {
    return '[depth_limited]';
  }

  if (visited.has(value)) {
    return '[circular]';
  }
  visited.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, DEFAULT_MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1, visited));
  }

  const record: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      record[key] = '[redacted]';
      continue;
    }

    record[key] = sanitizeValue(item, depth + 1, visited);
  }

  return record;
}

export function sanitizeStructuredData<T = any>(value: T): T {
  return sanitizeValue(value) as T;
}

export function recordRuntimeDiagnostic(input: Omit<RuntimeDiagnosticEvent, 'id' | 'timestamp' | 'source' | 'pid' | 'hostname'> & {
  timestamp?: string;
  source?: string;
}) {
  try {
    const filePath = getDiagnosticsFilePath();
    mkdirSync(dirname(filePath), { recursive: true });

    const event: RuntimeDiagnosticEvent = {
      id: randomUUID(),
      timestamp: input.timestamp || new Date().toISOString(),
      source: input.source || detectSource(),
      category: input.category,
      eventType: input.eventType,
      level: input.level,
      scope: input.scope,
      message: input.message ? truncateString(input.message) : undefined,
      traceId: input.traceId,
      tenantId: input.tenantId,
      userId: input.userId,
      tags: input.tags?.slice(0, DEFAULT_MAX_ITEMS),
      data: input.data ? sanitizeStructuredData(input.data) : undefined,
      pid: process.pid,
      hostname: hostname(),
    };

    appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Diagnostics logging must never break the main flow.
  }
}

export function readRuntimeDiagnostics(query: ReadRuntimeDiagnosticQuery = {}) {
  const filePath = getDiagnosticsFilePath();
  if (!existsSync(filePath)) {
    return [];
  }

  const limit = Math.min(Math.max(query.limit || 100, 1), 500);
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  const result: RuntimeDiagnosticEvent[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as RuntimeDiagnosticEvent;
      if (query.source && event.source !== query.source) {
        continue;
      }
      if (query.category && event.category !== query.category) {
        continue;
      }
      if (query.eventType && event.eventType !== query.eventType) {
        continue;
      }
      if (query.level && event.level !== query.level) {
        continue;
      }
      if (query.traceId && event.traceId !== query.traceId) {
        continue;
      }
      if (query.tenantId && event.tenantId !== query.tenantId) {
        continue;
      }
      if (query.search) {
        const haystack = JSON.stringify(event).toLowerCase();
        if (!haystack.includes(query.search.toLowerCase())) {
          continue;
        }
      }

      result.push(event);
      if (result.length >= limit) {
        break;
      }
    } catch {
      continue;
    }
  }

  return result;
}

export function registerRuntimeDiagnosticsProcessHandlers(source: string) {
  const markedProcess = process as typeof process & { [PROCESS_HANDLER_MARK]?: boolean };
  if (markedProcess[PROCESS_HANDLER_MARK]) {
    return;
  }
  markedProcess[PROCESS_HANDLER_MARK] = true;

  process.on('uncaughtException', (error) => {
    recordRuntimeDiagnostic({
      source,
      category: 'system',
      eventType: 'runtime_error',
      level: 'error',
      scope: 'process.uncaughtException',
      message: error.message,
      data: {
        stack: error.stack,
      },
    });
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    recordRuntimeDiagnostic({
      source,
      category: 'system',
      eventType: 'runtime_error',
      level: 'error',
      scope: 'process.unhandledRejection',
      message,
      data: {
        stack,
      },
    });
  });
}
