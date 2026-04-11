const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const {
  createServiceLogFiles,
  finalizeServiceLogFiles,
  prepareLogSession,
  rootDir,
  toRelativePath,
  updateSession,
  updateSessionService,
} = require('./lib/log-manager');
const {
  assertPortsAvailable,
  resolveRequiredPorts,
} = require('./dev.preflight');
const { prependCorepackToPath } = require('./lib/corepack');

const baseEnv = {
  ...process.env,
  COREPACK_HOME: process.env.COREPACK_HOME || path.join(rootDir, '.corepack'),
  PATH: prependCorepackToPath(),
};
const isCodexSandbox = Boolean(process.env.CODEX_THREAD_ID || process.env.CODEX_SANDBOX_NETWORK_DISABLED);

const sharedPackages = [
  'packages/shared-types',
  'packages/shared-schema',
  'packages/compat-engine',
  'packages/oa-adapters',
  'packages/agent-kernel',
];

const appPackageMap = {
  api: {
    dir: 'apps/api',
    scripts: {
      dev: 'dev',
      start: 'start',
    },
  },
  worker: {
    dir: 'apps/worker',
    scripts: {
      dev: 'dev',
      start: 'start',
    },
  },
  web: {
    dir: 'apps/web',
    scripts: {
      dev: 'dev',
      start: 'start',
    },
  },
};

const children = new Set();
let shuttingDown = false;
let logSession = null;

function finalizeSession(extraPatch = {}) {
  if (!logSession) {
    return;
  }

  updateSession(logSession.sessionDir, (session) => ({
    ...session,
    endedAt: new Date().toISOString(),
    ...extraPatch,
  }));
}

function killChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  finalizeSession({ exitCode: code });
  for (const child of children) {
    killChild(child);
  }

  setTimeout(() => {
    process.exit(code);
  }, 500);
}

function runStep(packageDir, scriptName, options = {}) {
  const normalizedOptions = options && typeof options === 'object'
    ? options
    : { persistent: Boolean(options) };
  const { persistent = false, serviceName = null } = normalizedOptions;
  const cwd = path.join(rootDir, packageDir);
  const label = `${packageDir}#${scriptName}`;
  console.log(`[dev] ${label}`);

  const childEnv = { ...baseEnv };
  let stdio = 'inherit';
  let serviceLogs = null;

  if (persistent && serviceName && logSession) {
    serviceLogs = createServiceLogFiles(logSession.sessionDir, serviceName);
    childEnv.RUNTIME_DIAGNOSTICS_FILE = logSession.diagnosticsFile;
    childEnv.RUNTIME_DIAGNOSTICS_SOURCE = serviceName;
    childEnv.APP_RUNTIME = serviceName;
    stdio = ['ignore', 'pipe', 'pipe'];

    updateSessionService(logSession.sessionDir, serviceName, {
      packageDir,
      scriptName,
      logDir: toRelativePath(serviceLogs.serviceDir),
      stdoutFile: toRelativePath(serviceLogs.stdoutFile),
      stderrFile: toRelativePath(serviceLogs.stderrFile),
      pidFile: toRelativePath(serviceLogs.pidFile),
      startedAt: new Date().toISOString(),
      status: 'starting',
    });

    console.log(`[dev] ${serviceName} logs: ${toRelativePath(serviceLogs.serviceDir)}`);
  }

  const child = spawn('corepack', ['pnpm', 'run', scriptName], {
    cwd,
    env: childEnv,
    stdio,
    shell: true,
  });

  if (serviceLogs) {
    fs.writeFileSync(serviceLogs.pidFile, `${child.pid}\n`, 'utf8');

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        serviceLogs.stdoutStream.write(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        serviceLogs.stderrStream.write(chunk);
      });
    }

    updateSessionService(logSession.sessionDir, serviceName, {
      pid: child.pid,
      status: 'running',
    });
  }

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (serviceLogs) {
      finalizeServiceLogFiles(serviceLogs);
      updateSessionService(logSession.sessionDir, serviceName, {
        endedAt: new Date().toISOString(),
        exitCode: code ?? null,
        signal: signal || null,
        status: shuttingDown ? 'stopped' : 'exited',
      });
    }

    if (shuttingDown) {
      return;
    }

    if (!persistent) {
      if (code === 0) {
        return;
      }
      console.error(`[dev] ${label} failed with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`);
      shutdown(code || 1);
      return;
    }

    console.error(`[dev] ${label} exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`);
    shutdown(code || 1);
  });

  child.on('error', (error) => {
    children.delete(child);
    if (serviceLogs) {
      finalizeServiceLogFiles(serviceLogs);
      updateSessionService(logSession.sessionDir, serviceName, {
        endedAt: new Date().toISOString(),
        status: 'failed_to_start',
        error: error.message,
      });
    }
    console.error(`[dev] ${label} failed to start: ${error.message}`);
    shutdown(1);
  });

  children.add(child);
  return child;
}

async function runBuilds() {
  for (const packageDir of sharedPackages) {
    await new Promise((resolve, reject) => {
      const child = runStep(packageDir, 'build', false);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${packageDir} build failed`));
      });
      child.on('error', reject);
    });
  }
}

async function runAppBuilds(appPackages) {
  for (const appPackage of appPackages) {
    await new Promise((resolve, reject) => {
      const child = runStep(appPackage.dir, 'build', false);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${appPackage.dir} build failed`));
      });
      child.on('error', reject);
    });
  }
}

function resolveRunMode(argv, env) {
  let requestedMode = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      requestedMode = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      requestedMode = arg.slice('--mode='.length);
    }
  }

  const mode = (requestedMode || env.UNIFLOW_RUN_MODE || 'dev').trim().toLowerCase();
  if (mode !== 'dev' && mode !== 'start') {
    throw new Error(`Unknown run mode: ${mode}. Expected one of: dev, start`);
  }

  return mode;
}

function resolveAppPackages(argv, env, mode) {
  let requestedApps = null;
  const skippedApps = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-worker') {
      skippedApps.add('worker');
      continue;
    }

    if (arg === '--apps') {
      requestedApps = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--apps=')) {
      requestedApps = arg.slice('--apps='.length);
    }
  }

  const configuredApps = requestedApps || env.UNIFLOW_DEV_APPS || '';
  const appNames = (configuredApps
    ? configuredApps.split(',')
    : Object.keys(appPackageMap)
  )
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .filter((name) => !skippedApps.has(name));

  const invalidApps = appNames.filter((name) => !Object.prototype.hasOwnProperty.call(appPackageMap, name));
  if (invalidApps.length > 0) {
    throw new Error(`Unknown app(s): ${invalidApps.join(', ')}. Expected one of: ${Object.keys(appPackageMap).join(', ')}`);
  }

  if (appNames.length === 0) {
    throw new Error('No apps selected to start.');
  }

  return appNames.map((name) => {
    const appPackage = appPackageMap[name];
    const requiresPrebuild = isCodexSandbox && mode === 'dev' && name === 'web';
    const scriptName = requiresPrebuild ? 'start' : appPackage.scripts[mode];

    if (!scriptName) {
      throw new Error(`App ${name} does not support run mode ${mode}`);
    }

    return {
      name,
      dir: appPackage.dir,
      scriptName,
      requiresPrebuild,
    };
  });
}

async function main() {
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  try {
    const mode = resolveRunMode(process.argv.slice(2), process.env);
    const appPackages = resolveAppPackages(process.argv.slice(2), process.env, mode);
    logSession = prepareLogSession({
      mode,
      apps: appPackages.map((item) => item.name),
    });

    console.log(`[dev] mode: ${mode}`);
    console.log(`[dev] selected apps: ${appPackages.map((item) => item.dir).join(', ')}`);
    console.log(`[dev] current logs: ${toRelativePath(logSession.sessionDir)}`);
    console.log(`[dev] diagnostics: ${toRelativePath(logSession.diagnosticsFile)}`);
    if (logSession.archivedCurrent.archived) {
      console.log(`[dev] archived previous current logs to ${toRelativePath(logSession.archivedCurrent.to)}`);
    } else if (logSession.archivedCurrent.reason === 'active') {
      const activeSessionId = logSession.archivedCurrent.session?.sessionId || 'unknown';
      console.log(`[dev] existing current session "${activeSessionId}" is still active; new logs will use ${toRelativePath(logSession.sessionDir)}`);
    }
    if (isCodexSandbox && mode === 'dev' && appPackages.some((item) => item.name === 'web')) {
      console.log('[dev] Codex sandbox detected; apps/web will run with a prebuild + next start fallback (no HMR)');
    }
    try {
      await assertPortsAvailable(resolveRequiredPorts(appPackages));
    } catch (error) {
      if (logSession.archivedCurrent.reason === 'active') {
        error.message = `${error.message} Run "pnpm logs:stop" to stop the current session first.`;
      }
      throw error;
    }
    await runBuilds();
    const prebuildApps = mode === 'start'
      ? appPackages
      : appPackages.filter((item) => item.requiresPrebuild);
    if (prebuildApps.length > 0) {
      await runAppBuilds(prebuildApps);
    }
    for (const packageDir of appPackages) {
      runStep(packageDir.dir, packageDir.scriptName, {
        persistent: true,
        serviceName: packageDir.name,
      });
    }
  } catch (error) {
    console.error(`[dev] startup aborted: ${error.message}`);
    shutdown(1);
  }
}

main();
