const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { shouldDisableWebpackBuildWorker } = require('./next.config.shared');

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

function normalizeUrl(value) {
  return (value || '').trim().replace(/\/+$/, '');
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
const publicApiUrl = normalizeUrl(process.env.NEXT_PUBLIC_API_URL || workspaceEnv.NEXT_PUBLIC_API_URL || '');
const internalApiOrigin = normalizeUrl(
  process.env.INTERNAL_API_ORIGIN
  || workspaceEnv.INTERNAL_API_ORIGIN
  || publicApiUrl
  || 'http://127.0.0.1:3001',
);
const publicAuthMode = (process.env.NEXT_PUBLIC_AUTH_MODE || workspaceEnv.NEXT_PUBLIC_AUTH_MODE || 'legacy').trim();
const publicAuthProviderName = (process.env.NEXT_PUBLIC_AUTH_PROVIDER_NAME || workspaceEnv.NEXT_PUBLIC_AUTH_PROVIDER_NAME || '').trim();
const outputMode = process.env.NEXT_OUTPUT_MODE || workspaceEnv.NEXT_OUTPUT_MODE || '';
const distDirOverride = (process.env.NEXT_DIST_DIR || workspaceEnv.NEXT_DIST_DIR || '').trim();
const isCodexSandbox = Boolean(process.env.CODEX_THREAD_ID || process.env.CODEX_SANDBOX_NETWORK_DISABLED);
const disableBuildWorker = shouldDisableWebpackBuildWorker({
  env: process.env,
  workspaceEnv,
  platform: process.platform,
  nodeEnv: process.env.NODE_ENV || 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
    NEXT_PUBLIC_AUTH_MODE: publicAuthMode,
    NEXT_PUBLIC_AUTH_PROVIDER_NAME: publicAuthProviderName,
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${internalApiOrigin}/api/v1/:path*`,
      },
      {
        source: '/api/docs',
        destination: `${internalApiOrigin}/api/docs`,
      },
      {
        source: '/api/docs/:path*',
        destination: `${internalApiOrigin}/api/docs/:path*`,
      },
    ];
  },
};

if (distDirOverride) {
  nextConfig.distDir = distDirOverride;
}

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
