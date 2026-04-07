const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const logsDir = path.join(rootDir, '.logs');
const currentDir = path.join(logsDir, 'current');
const runsDir = path.join(logsDir, 'runs');
const archiveDir = path.join(logsDir, 'archive');
const sessionFileName = 'session.json';
const diagnosticsRelativePath = path.join('diagnostics', 'runtime-diagnostics.jsonl');
const reservedRootEntries = new Set(['current', 'runs', 'archive', 'README.md', '.gitkeep']);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function toRelativePath(targetPath) {
  return normalizePath(path.relative(rootDir, targetPath));
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function ensureBaseDirs() {
  ensureDir(logsDir);
  ensureDir(runsDir);
  ensureDir(archiveDir);
}

function isPathWithin(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPathWithinLogs(targetPath) {
  if (!isPathWithin(logsDir, targetPath)) {
    throw new Error(`Refusing to access path outside ${logsDir}: ${targetPath}`);
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sanitizeSegment(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

function formatSessionStamp(date = new Date()) {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return iso.replace(/[:]/g, '').replace('T', '-').replace('Z', '');
}

function uniquePath(targetPath) {
  assertPathWithinLogs(targetPath);
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  let counter = 1;
  while (true) {
    const candidate = `${targetPath}-${counter}`;
    assertPathWithinLogs(candidate);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      return true;
    }
    return false;
  }
}

function readSession(sessionDir) {
  return readJson(path.join(sessionDir, sessionFileName));
}

function updateSession(sessionDir, updater) {
  const sessionPath = path.join(sessionDir, sessionFileName);
  const current = readJson(sessionPath) || {};
  const next = typeof updater === 'function'
    ? updater(current)
    : { ...current, ...updater };
  writeJson(sessionPath, next);
  return next;
}

function updateSessionService(sessionDir, serviceName, patch) {
  return updateSession(sessionDir, (session) => {
    const services = { ...(session.services || {}) };
    services[serviceName] = {
      ...(services[serviceName] || {}),
      ...patch,
    };

    return {
      ...session,
      services,
      updatedAt: new Date().toISOString(),
    };
  });
}

function archiveStaleCurrentSession() {
  if (!fs.existsSync(currentDir)) {
    return { archived: false, reason: 'missing' };
  }

  const currentSession = readSession(currentDir);
  const currentRunnerPid = currentSession?.runnerPid;
  if (currentRunnerPid && isProcessAlive(currentRunnerPid) && currentRunnerPid !== process.pid) {
    return {
      archived: false,
      reason: 'active',
      session: currentSession,
    };
  }

  const sessionId = sanitizeSegment(currentSession?.sessionId || `orphan-${formatSessionStamp()}`);
  const targetPath = uniquePath(path.join(runsDir, sessionId));
  assertPathWithinLogs(currentDir);
  assertPathWithinLogs(targetPath);
  fs.renameSync(currentDir, targetPath);

  return {
    archived: true,
    from: currentDir,
    to: targetPath,
    session: currentSession,
  };
}

function prepareLogSession({ mode, apps }) {
  ensureBaseDirs();

  const archivedCurrent = archiveStaleCurrentSession();
  const sessionId = [
    formatSessionStamp(),
    sanitizeSegment(mode),
    apps.map((app) => sanitizeSegment(app)).join('-'),
  ].filter(Boolean).join('_');

  const hasActiveCurrent = archivedCurrent.reason === 'active';
  const sessionDir = hasActiveCurrent
    ? uniquePath(path.join(runsDir, sessionId))
    : currentDir;

  assertPathWithinLogs(sessionDir);
  ensureDir(sessionDir);
  ensureDir(path.join(sessionDir, 'diagnostics'));

  const session = {
    sessionId,
    mode,
    apps,
    startedAt: new Date().toISOString(),
    runnerPid: process.pid,
    hostname: os.hostname(),
    sessionDir: toRelativePath(sessionDir),
    diagnosticsFile: toRelativePath(path.join(sessionDir, diagnosticsRelativePath)),
    usesCurrentAlias: sessionDir === currentDir,
    archivedPreviousCurrent: archivedCurrent.archived
      ? {
          from: toRelativePath(archivedCurrent.from),
          to: toRelativePath(archivedCurrent.to),
        }
      : null,
  };

  writeJson(path.join(sessionDir, sessionFileName), session);

  return {
    session,
    sessionDir,
    diagnosticsFile: path.join(sessionDir, diagnosticsRelativePath),
    archivedCurrent,
  };
}

function getServiceLogPaths(sessionDir, serviceName) {
  const serviceDir = path.join(sessionDir, sanitizeSegment(serviceName));
  return {
    serviceDir,
    stdoutFile: path.join(serviceDir, 'stdout.log'),
    stderrFile: path.join(serviceDir, 'stderr.log'),
    pidFile: path.join(serviceDir, 'pid'),
    diagnosticsFile: path.join(sessionDir, diagnosticsRelativePath),
  };
}

function createServiceLogFiles(sessionDir, serviceName) {
  const paths = getServiceLogPaths(sessionDir, serviceName);
  ensureDir(paths.serviceDir);
  ensureDir(path.dirname(paths.diagnosticsFile));

  return {
    ...paths,
    stdoutStream: fs.createWriteStream(paths.stdoutFile, { flags: 'a' }),
    stderrStream: fs.createWriteStream(paths.stderrFile, { flags: 'a' }),
  };
}

function finalizeServiceLogFiles(serviceLogs) {
  serviceLogs.stdoutStream.end();
  serviceLogs.stderrStream.end();
}

function listLooseRootFiles() {
  ensureBaseDirs();
  return fs.readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !reservedRootEntries.has(entry.name))
    .map((entry) => path.join(logsDir, entry.name));
}

function classifyLegacyFile(fileName) {
  if (fileName === 'runtime-diagnostics.jsonl') {
    return path.join('diagnostics', fileName);
  }

  if (fileName.endsWith('.pid')) {
    return path.join('pids', fileName);
  }

  const streamMatch = fileName.match(/^(.+)\.(out|err)\.log$/i);
  if (streamMatch) {
    const serviceName = sanitizeSegment(streamMatch[1]);
    const streamName = streamMatch[2].toLowerCase() === 'out' ? 'stdout.log' : 'stderr.log';
    return path.join('streams', serviceName, streamName);
  }

  const genericLogMatch = fileName.match(/^(.+)\.log$/i);
  if (genericLogMatch) {
    const serviceName = sanitizeSegment(genericLogMatch[1]);
    return path.join('streams', serviceName, 'combined.log');
  }

  return path.join('other', fileName);
}

function archiveLegacyRootLogs({ dryRun = false } = {}) {
  const looseFiles = listLooseRootFiles();
  if (looseFiles.length === 0) {
    return {
      archivePath: null,
      archivedFiles: [],
      skippedFiles: [],
      dryRun,
    };
  }

  const archivePath = uniquePath(path.join(archiveDir, `legacy-${formatSessionStamp()}`));
  const archivedFiles = [];
  const skippedFiles = [];

  for (const sourcePath of looseFiles) {
    const fileName = path.basename(sourcePath);
    const destinationPath = path.join(archivePath, classifyLegacyFile(fileName));
    assertPathWithinLogs(destinationPath);

    const stat = fs.statSync(sourcePath);
    const record = {
      source: toRelativePath(sourcePath),
      destination: toRelativePath(destinationPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };

    if (dryRun) {
      archivedFiles.push(record);
      continue;
    }

    try {
      ensureDir(path.dirname(destinationPath));
      fs.renameSync(sourcePath, destinationPath);
      archivedFiles.push(record);
    } catch (error) {
      skippedFiles.push({
        ...record,
        error: error.message,
      });
    }
  }

  if (!dryRun && (archivedFiles.length > 0 || skippedFiles.length > 0)) {
    ensureDir(archivePath);
    writeJson(path.join(archivePath, 'manifest.json'), {
      archivedAt: new Date().toISOString(),
      archivedFiles,
      skippedFiles,
    });
  }

  return {
    archivePath,
    archivedFiles,
    skippedFiles,
    dryRun,
  };
}

function listSessions(limit = 10) {
  ensureBaseDirs();
  const sessions = [];

  const currentSession = readSession(currentDir);
  if (currentSession) {
    sessions.push({
      type: 'current',
      session: currentSession,
      sessionDir: currentDir,
    });
  }

  const runEntries = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sessionDir = path.join(runsDir, entry.name);
      return {
        type: 'run',
        session: readSession(sessionDir) || {
          sessionId: entry.name,
          sessionDir: toRelativePath(sessionDir),
        },
        sessionDir,
      };
    })
    .sort((left, right) => {
      const leftTime = left.session.startedAt || left.session.updatedAt || '';
      const rightTime = right.session.startedAt || right.session.updatedAt || '';
      return rightTime.localeCompare(leftTime);
    });

  sessions.push(...runEntries.slice(0, Math.max(limit - sessions.length, 0)));
  return sessions;
}

function listArchiveBundles(limit = 10) {
  ensureBaseDirs();
  return fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const bundleDir = path.join(archiveDir, entry.name);
      const manifest = readJson(path.join(bundleDir, 'manifest.json')) || {};
      return {
        bundleId: entry.name,
        bundleDir,
        archivedAt: manifest.archivedAt || '',
        fileCount: Array.isArray(manifest.archivedFiles) ? manifest.archivedFiles.length : 0,
      };
    })
    .sort((left, right) => {
      const leftTime = left.archivedAt || left.bundleId;
      const rightTime = right.archivedAt || right.bundleId;
      return rightTime.localeCompare(leftTime);
    })
    .slice(0, limit);
}

function resolveCurrentSession() {
  const currentSession = readSession(currentDir);
  if (currentSession) {
    return {
      type: 'current',
      session: currentSession,
      sessionDir: currentDir,
    };
  }

  return listSessions(1)[0] || null;
}

function readLastLines(filePath, lineCount = 80) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-Math.max(lineCount, 1));
}

function findWorkspaceRoot(startDir = process.cwd()) {
  let currentPath = path.resolve(startDir);

  while (true) {
    if (
      fs.existsSync(path.join(currentPath, 'pnpm-workspace.yaml'))
      || fs.existsSync(path.join(currentPath, '.git'))
    ) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return path.resolve(startDir);
    }
    currentPath = parentPath;
  }
}

function getDefaultDiagnosticsFilePath(startDir = process.cwd()) {
  const workspaceRoot = process.env.UNIFLOW_LOG_ROOT || findWorkspaceRoot(startDir);
  return path.join(workspaceRoot, '.logs', 'current', diagnosticsRelativePath);
}

module.exports = {
  archiveLegacyRootLogs,
  archiveDir,
  createServiceLogFiles,
  currentDir,
  diagnosticsRelativePath,
  finalizeServiceLogFiles,
  getDefaultDiagnosticsFilePath,
  getServiceLogPaths,
  listArchiveBundles,
  listLooseRootFiles,
  listSessions,
  logsDir,
  prepareLogSession,
  readLastLines,
  readSession,
  resolveCurrentSession,
  rootDir,
  runsDir,
  toRelativePath,
  updateSession,
  updateSessionService,
};
