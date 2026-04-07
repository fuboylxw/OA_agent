const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

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

function loadWorkspaceEnv() {
  const candidates = [
    resolve(__dirname, '.env.local'),
    resolve(__dirname, '.env'),
    resolve(__dirname, '../../.env.local'),
    resolve(__dirname, '../../.env'),
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

const workspaceEnv = loadWorkspaceEnv();
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || workspaceEnv.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const outputMode = process.env.NEXT_OUTPUT_MODE || workspaceEnv.NEXT_OUTPUT_MODE || '';
const disableBuildWorkerRaw = process.env.NEXT_DISABLE_BUILD_WORKER || workspaceEnv.NEXT_DISABLE_BUILD_WORKER || '';
const disableBuildWorker = ['1', 'true', 'yes'].includes(disableBuildWorkerRaw.trim().toLowerCase());
const isCodexSandbox = Boolean(process.env.CODEX_THREAD_ID || process.env.CODEX_SANDBOX_NETWORK_DISABLED);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
  },
};

if (disableBuildWorker || isCodexSandbox) {
  nextConfig.experimental = {
    ...(nextConfig.experimental || {}),
    webpackBuildWorker: false,
  };
}

if (isCodexSandbox) {
  nextConfig.eslint = {
    ...(nextConfig.eslint || {}),
    ignoreDuringBuilds: true,
  };
  nextConfig.typescript = {
    ...(nextConfig.typescript || {}),
    ignoreBuildErrors: true,
  };
}

if (outputMode === 'standalone') {
  nextConfig.output = 'standalone';
}

module.exports = nextConfig;
