const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { spawn } = require('child_process');

function parseEnvFile(input) {
  const values = {};

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function loadWorkspaceEnv(appDir) {
  const candidates = [
    resolve(appDir, '.env.local'),
    resolve(appDir, '.env'),
    resolve(appDir, '../../.env.local'),
    resolve(appDir, '../../.env'),
  ];

  const merged = {};
  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(readFileSync(filePath, 'utf8')));
  }

  return merged;
}

function deriveHostFromPublicBaseUrl(value) {
  const raw = (value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

function derivePortFromPublicBaseUrl(value) {
  const raw = (value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const port = new URL(raw).port;
    return port || '';
  } catch {
    return '';
  }
}

function normalizePort(value, fallback = 3000) {
  const port = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return fallback;
  }
  return port;
}

function main() {
  const appDir = resolve(__dirname, '../apps/web');
  const workspaceEnv = loadWorkspaceEnv(appDir);
  const distDir = (process.env.NEXT_DIST_DIR || workspaceEnv.NEXT_DIST_DIR || '.next-dev').trim();
  const bindHost = (
    process.env.WEB_BIND_HOST
    || workspaceEnv.WEB_BIND_HOST
    || deriveHostFromPublicBaseUrl(process.env.PUBLIC_WEB_BASE_URL || workspaceEnv.PUBLIC_WEB_BASE_URL)
    || '0.0.0.0'
  ).trim();
  const port = normalizePort(
    process.env.WEB_PORT
    || workspaceEnv.WEB_PORT
    || derivePortFromPublicBaseUrl(process.env.PUBLIC_WEB_BASE_URL || workspaceEnv.PUBLIC_WEB_BASE_URL)
    || process.env.PORT
    || workspaceEnv.PORT,
    3000,
  );
  const accessUrl = (process.env.PUBLIC_WEB_BASE_URL || workspaceEnv.PUBLIC_WEB_BASE_URL || '').trim()
    || `http://${bindHost}:${port}`;
  const nextBin = require.resolve('next/dist/bin/next', { paths: [appDir] });
  const childEnv = {
    ...workspaceEnv,
    ...process.env,
    HOST: bindHost,
    HOSTNAME: bindHost,
    NEXT_DIST_DIR: distDir,
    PORT: String(port),
    WEB_PORT: String(port),
    WEB_BIND_HOST: bindHost,
  };

  console.log(`[web-dev] binding Next.js dev server to ${bindHost}:${port}`);
  console.log(`[web-dev] access URL: ${accessUrl.replace(/\/+$/, '')}`);
  console.log(`[web-dev] dist dir: ${distDir}`);

  const child = spawn(process.execPath, [nextBin, 'dev', '-H', bindHost, '-p', String(port)], {
    cwd: appDir,
    env: childEnv,
    stdio: 'inherit',
  });

  const forwardSignal = (signal) => {
    if (child.exitCode === null) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code || 0);
  });
}

main();
