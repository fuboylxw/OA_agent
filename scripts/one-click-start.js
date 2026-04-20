#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');
const { prependCorepackToPath } = require('./lib/corepack');

const rootDir = path.resolve(__dirname, '..');
let loadedEnvValues = {};
let env = createRuntimeEnv();

function createRuntimeEnv(extraValues = {}) {
  return {
    ...process.env,
    ...extraValues,
    COREPACK_HOME: process.env.COREPACK_HOME || path.join(rootDir, '.corepack'),
    PATH: prependCorepackToPath(),
  };
}

function print(message = '') {
  process.stdout.write(`${message}\n`);
}

function step(message) {
  print('');
  print(`🚀 ${message}`);
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function normalizeHost(value, fallback = '127.0.0.1') {
  const host = String(value || fallback).trim();
  if (!host) {
    return fallback;
  }

  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1).toLowerCase();
  }

  return host.toLowerCase();
}

function normalizeConnectHost(host) {
  const normalized = normalizeHost(host);
  if (normalized === '0.0.0.0' || normalized === '::') {
    return '127.0.0.1';
  }

  return normalized;
}

function getLocalAddresses() {
  const addresses = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
  let interfaces = {};

  try {
    interfaces = os.networkInterfaces() || {};
  } catch {
    return addresses;
  }

  Object.values(interfaces).forEach((items) => {
    (items || []).forEach((item) => {
      if (item && item.address) {
        addresses.add(normalizeHost(item.address));
      }
    });
  });

  return addresses;
}

const localAddresses = getLocalAddresses();

function isLocalTarget(host) {
  const normalizedHost = normalizeHost(host);
  return localAddresses.has(normalizedHost) || localAddresses.has(normalizeConnectHost(normalizedHost));
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\''))) {
    return text.slice(1, -1);
  }

  return text;
}

function parseEnvFile(filePath) {
  const values = {};
  const content = fs.readFileSync(filePath, 'utf8');

  content.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1));
    if (!key) {
      return;
    }

    values[key] = value;
  });

  return values;
}

function refreshEnvFromFile() {
  const envFile = path.join(rootDir, '.env');
  loadedEnvValues = parseEnvFile(envFile);
  env = createRuntimeEnv(loadedEnvValues);
  return loadedEnvValues;
}

function runCommand(command, args, options = {}) {
  const {
    cwd = rootDir,
    stdio = 'inherit',
    customEnv = env,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: customEnv,
      stdio,
      shell: true,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${formatCommand(command, args)} terminated by signal ${signal}`));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${formatCommand(command, args)} exited with code ${code ?? 'null'}`));
    });

    child.on('error', (error) => {
      reject(new Error(`${formatCommand(command, args)} failed to start: ${error.message}`));
    });
  });
}

function captureCommand(command, args, options = {}) {
  const {
    cwd = rootDir,
    customEnv = env,
  } = options;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, {
      cwd,
      env: customEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${formatCommand(command, args)} terminated by signal ${signal}`));
        return;
      }

      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const errorSuffix = stderr.trim() ? `: ${stderr.trim()}` : '';
      reject(new Error(`${formatCommand(command, args)} exited with code ${code ?? 'null'}${errorSuffix}`));
    });

    child.on('error', (error) => {
      reject(new Error(`${formatCommand(command, args)} failed to start: ${error.message}`));
    });
  });
}

function ensureEnvFile() {
  const envFile = path.join(rootDir, '.env');
  if (fs.existsSync(envFile)) {
    return false;
  }

  const envExampleFile = path.join(rootDir, '.env.example');
  if (!fs.existsSync(envExampleFile)) {
    throw new Error('Missing .env.example; cannot create default .env file.');
  }

  fs.copyFileSync(envExampleFile, envFile);
  print('📝 .env not found, copied from .env.example');
  return true;
}

function hasInstalledDependencies() {
  return fs.existsSync(path.join(rootDir, 'node_modules'));
}

function hasPrismaMigrations() {
  const migrationsDir = path.join(rootDir, 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return false;
  }

  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .some((entry) => entry.isDirectory());
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function checkTcpPortWithNode(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
    socket.connect(port, host);
  });
}

async function checkTcpPort(host, port, timeoutMs = 1500) {
  const reachableViaNode = await checkTcpPortWithNode(host, port, timeoutMs);
  if (reachableViaNode) {
    return true;
  }

  try {
    await captureCommand('nc', ['-vz', host, String(port)]);
    return true;
  } catch {
    return false;
  }
}

function resolvePostgresTarget(envValues) {
  const databaseUrl = stripWrappingQuotes(envValues.DATABASE_URL || '');
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      return {
        dockerServiceName: 'postgres',
        label: 'PostgreSQL',
        host: normalizeHost(parsed.hostname, envValues.POSTGRES_HOST || '127.0.0.1'),
        port: parseInteger(parsed.port || envValues.POSTGRES_PORT, 5432),
      };
    } catch {
      // ignore invalid DATABASE_URL and fall back to individual env vars
    }
  }

  return {
    dockerServiceName: 'postgres',
    label: 'PostgreSQL',
    host: normalizeHost(envValues.POSTGRES_HOST || envValues.POSTGRES_BIND_HOST || '127.0.0.1'),
    port: parseInteger(envValues.POSTGRES_PORT, 5432),
  };
}

function resolveInfrastructureTargets(envValues) {
  const attachmentDriver = (envValues.ATTACHMENT_STORAGE_DRIVER || 'local').trim().toLowerCase();

  const targets = [
    resolvePostgresTarget(envValues),
    {
      dockerServiceName: 'redis',
      label: 'Redis',
      host: normalizeHost(envValues.REDIS_HOST || '127.0.0.1'),
      port: parseInteger(envValues.REDIS_PORT, 6379),
    },
  ];

  if (attachmentDriver === 'minio') {
    targets.push({
      dockerServiceName: 'minio',
      label: 'MinIO',
      host: normalizeHost(envValues.MINIO_ENDPOINT || '127.0.0.1'),
      port: parseInteger(envValues.MINIO_PORT, 9000),
    });
  } else {
    print(`ℹ️  Attachment storage driver is "${attachmentDriver}", skipping MinIO startup`);
  }

  return targets.map((target) => ({
    ...target,
    connectHost: normalizeConnectHost(target.host),
    canStartWithDocker: isLocalTarget(target.host),
  }));
}

async function waitForDockerHealth(serviceName, options = {}) {
  const timeoutMs = options.timeoutMs || 120000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const containerId = await captureCommand('docker', ['compose', 'ps', '-q', serviceName])
      .catch(() => '');

    if (!containerId) {
      await sleep(2000);
      continue;
    }

    const status = await captureCommand('docker', [
      'inspect',
      '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      containerId,
    ]).catch(() => '');

    if (status === 'healthy' || status === 'running') {
      print(`✅ ${serviceName} is ${status}`);
      return;
    }

    if (status) {
      print(`⏳ waiting for ${serviceName} (${status})...`);
    }

    await sleep(2000);
  }

  throw new Error(`Timed out waiting for docker service "${serviceName}" to become healthy.`);
}

async function ensureDockerReady() {
  step('Checking Docker availability');
  await runCommand('docker', ['info'], { stdio: 'ignore' }).catch(() => {
    throw new Error('Docker is not available or not running. Please start Docker first.');
  });
}

async function ensureDependencies() {
  if (hasInstalledDependencies()) {
    return;
  }

  step('Installing dependencies');
  await runCommand('corepack', ['pnpm', 'install']);
}

async function ensureInfrastructure(envValues, options = {}) {
  const { preferExternalServices = false } = options;
  step('Checking infrastructure services');
  if (preferExternalServices) {
    print('ℹ️  Existing .env detected, preferring host-managed services over Docker');
  }
  const targets = resolveInfrastructureTargets(envValues);
  const missingTargets = [];

  for (const target of targets) {
    const reachable = await checkTcpPort(target.connectHost, target.port);
    if (reachable) {
      print(`✅ ${target.label} available at ${target.host}:${target.port}, skipping Docker`);
      continue;
    }

    if (!target.canStartWithDocker || preferExternalServices) {
      print(`⚠️  Could not verify ${target.label} at ${target.host}:${target.port}; assuming it is managed outside Docker`);
      continue;
    }

    print(`⚠️  ${target.label} is not reachable at ${target.host}:${target.port}, will start with Docker`);
    missingTargets.push(target);
  }

  if (missingTargets.length === 0) {
    print('✅ All required infrastructure services are already available');
    return;
  }

  await ensureDockerReady();

  const dockerServiceNames = missingTargets.map((target) => target.dockerServiceName);
  step(`Starting missing infrastructure via Docker: ${dockerServiceNames.join(', ')}`);

  try {
    await runCommand('docker', ['compose', 'up', '-d', ...dockerServiceNames]);
  } catch (error) {
    const message = error.message || String(error);
    if (/failed to resolve reference|i\/o timeout|TLS handshake timeout|Client\.Timeout/i.test(message)) {
      throw new Error(`Docker image pull failed due to registry timeout. Missing services: ${dockerServiceNames.join(', ')}. If you already installed these services on the host, make sure .env points to them correctly and they are running.`);
    }
    throw error;
  }

  step('Waiting for newly started Docker services');
  for (const target of missingTargets) {
    await waitForDockerHealth(target.dockerServiceName);
  }
}

async function syncDatabase() {
  step('Generating Prisma client');
  await runCommand('corepack', ['pnpm', 'run', 'db:generate']);

  step(hasPrismaMigrations() ? 'Applying Prisma migrations' : 'Syncing Prisma schema with database');
  if (hasPrismaMigrations()) {
    await runCommand('corepack', ['pnpm', 'exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
  } else {
    await runCommand('corepack', ['pnpm', 'exec', 'prisma', 'db', 'push', '--schema', 'prisma/schema.prisma']);
  }

  step('Seeding database');
  await runCommand('corepack', ['pnpm', 'run', 'db:seed']);
}

async function startApplications() {
  step('Starting application services');
  print('Frontend: http://localhost:3000');
  print('API:      http://localhost:3001');
  print('Logs:     pnpm logs');
  print('Stop:     pnpm logs:stop');
  await runCommand('corepack', ['pnpm', 'run', 'dev']);
}

async function main() {
  print('✨ UniFlow OA one-click startup');

  const envFileCreated = ensureEnvFile();
  const envValues = refreshEnvFromFile();
  await ensureDependencies();
  await ensureInfrastructure(envValues, {
    preferExternalServices: !envFileCreated,
  });
  await syncDatabase();
  await startApplications();
}

main().catch((error) => {
  process.stderr.write(`\n❌ One-click startup failed: ${error.message}\n`);
  process.exit(1);
});
