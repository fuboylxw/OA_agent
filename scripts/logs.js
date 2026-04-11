#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  archiveLegacyRootLogs,
  getServiceLogPaths,
  listArchiveBundles,
  listLooseRootFiles,
  listSessions,
  readLastLines,
  resolveCurrentSession,
  rootDir,
  toRelativePath,
  updateSession,
  updateSessionService,
} = require('./lib/log-manager');
const { stopSessionProcesses } = require('./session-control');

function print(message = '') {
  process.stdout.write(`${message}\n`);
}

function printUsage() {
  print('Usage: node scripts/logs.js <command> [args]');
  print('');
  print('Commands:');
  print('  summary                     Show current logs and recent sessions');
  print('  sessions                    List current and recent archived sessions');
  print('  path <service|diagnostics>  Print absolute log path for the current session');
  print('  tail <service|diagnostics> [stdout|stderr] [lines]');
  print('                              Print the last lines from the current session');
  print('  stop                        Stop the current dev session and free its ports');
  print('  archive-legacy [--dry-run]  Move loose root-level .logs files into archive/');
}

function resolveRequestedFile(sessionInfo, targetName, streamName) {
  if (!sessionInfo) {
    throw new Error('No log session found.');
  }

  if (!targetName || targetName === 'diagnostics') {
    const diagnosticsFile = path.join(sessionInfo.sessionDir, 'diagnostics', 'runtime-diagnostics.jsonl');
    return {
      kind: 'diagnostics',
      filePath: diagnosticsFile,
    };
  }

  const serviceLogs = getServiceLogPaths(sessionInfo.sessionDir, targetName);
  const stream = (streamName || 'stdout').toLowerCase();
  if (stream !== 'stdout' && stream !== 'stderr') {
    throw new Error(`Unknown stream "${stream}". Expected stdout or stderr.`);
  }

  return {
    kind: stream,
    filePath: stream === 'stdout' ? serviceLogs.stdoutFile : serviceLogs.stderrFile,
  };
}

function printSummary() {
  const sessionInfo = resolveCurrentSession();
  if (!sessionInfo) {
    print('No log session found yet.');
  } else {
    const { session } = sessionInfo;
    print('Current log session');
    print(`  id: ${session.sessionId || 'unknown'}`);
    print(`  mode: ${session.mode || 'unknown'}`);
    print(`  apps: ${(session.apps || []).join(', ') || 'unknown'}`);
    print(`  started: ${session.startedAt || 'unknown'}`);
    print(`  path: ${path.join(rootDir, session.sessionDir || toRelativePath(sessionInfo.sessionDir))}`);
    print(`  diagnostics: ${path.join(rootDir, session.diagnosticsFile || toRelativePath(path.join(sessionInfo.sessionDir, 'diagnostics', 'runtime-diagnostics.jsonl')))}`);

    const serviceNames = Object.keys(session.services || {});
    if (serviceNames.length > 0) {
      print('  services:');
      for (const serviceName of serviceNames.sort()) {
        const service = session.services[serviceName];
        const status = service.status || 'unknown';
        const stdoutPath = service.stdoutFile ? path.join(rootDir, service.stdoutFile) : '';
        print(`    ${serviceName}: ${status}${stdoutPath ? ` -> ${stdoutPath}` : ''}`);
      }
    }
  }

  const recentRuns = listSessions(6).filter((item) => item.type === 'run').slice(0, 5);
  if (recentRuns.length > 0) {
    print('');
    print('Recent archived sessions');
    for (const item of recentRuns) {
      print(`  ${item.session.sessionId || path.basename(item.sessionDir)} -> ${path.join(rootDir, item.session.sessionDir || toRelativePath(item.sessionDir))}`);
    }
  }

  const recentArchives = listArchiveBundles(5);
  if (recentArchives.length > 0) {
    print('');
    print('Recent legacy archives');
    for (const item of recentArchives) {
      print(`  ${item.bundleId} (${item.fileCount} files) -> ${path.resolve(item.bundleDir)}`);
    }
  }

  const looseFiles = listLooseRootFiles();
  if (looseFiles.length > 0) {
    print('');
    print(`Loose legacy files: ${looseFiles.length} (run "pnpm logs:organize" to archive them)`);
  }
}

function printSessions() {
  const sessions = listSessions(20);
  const archives = listArchiveBundles(20);
  if (sessions.length === 0 && archives.length === 0) {
    print('No log sessions found.');
    return;
  }

  for (const item of sessions) {
    const marker = item.type === 'current' ? '*' : '-';
    const sessionId = item.session.sessionId || path.basename(item.sessionDir);
    const startedAt = item.session.startedAt || 'unknown';
    const sessionPath = item.session.sessionDir || toRelativePath(item.sessionDir);
    print(`${marker} ${sessionId}\t${startedAt}\t${path.join(rootDir, sessionPath)}`);
  }

  for (const item of archives) {
    print(`a ${item.bundleId}\t${item.archivedAt || 'unknown'}\t${path.resolve(item.bundleDir)}`);
  }
}

function printPath(targetName) {
  const sessionInfo = resolveCurrentSession();
  const resolved = resolveRequestedFile(sessionInfo, targetName, 'stdout');
  print(path.resolve(resolved.filePath));
}

function printTail(targetName, streamName, lineCountValue) {
  const sessionInfo = resolveCurrentSession();
  const lineCount = Number.parseInt(lineCountValue || '80', 10);
  const resolved = resolveRequestedFile(sessionInfo, targetName, streamName);

  if (!fs.existsSync(resolved.filePath)) {
    throw new Error(`Log file not found: ${resolved.filePath}`);
  }

  const lines = readLastLines(resolved.filePath, Number.isNaN(lineCount) ? 80 : lineCount);
  for (const line of lines) {
    print(line);
  }
}

function printArchiveSummary(result) {
  if (!result.archivePath && result.archivedFiles.length === 0) {
    print('No loose legacy files found in .logs.');
    return;
  }

  const destination = result.archivePath ? path.resolve(result.archivePath) : '(dry-run)';
  print(`${result.dryRun ? 'Planned archive' : 'Archived legacy logs'}: ${destination}`);
  print(`Archived files: ${result.archivedFiles.length}`);
  for (const file of result.archivedFiles) {
    print(`  ${file.source} -> ${file.destination}`);
  }

  if (result.skippedFiles.length > 0) {
    print(`Skipped files: ${result.skippedFiles.length}`);
    for (const file of result.skippedFiles) {
      print(`  ${file.source} (${file.error})`);
    }
  }
}

function stopCurrentSession() {
  const sessionInfo = resolveCurrentSession();
  if (!sessionInfo || sessionInfo.type !== 'current') {
    print('No current session is running.');
    return;
  }

  const stopRequestedAt = new Date().toISOString();
  const result = stopSessionProcesses(sessionInfo.session);

  updateSession(sessionInfo.sessionDir, (session) => ({
    ...session,
    stopRequestedAt,
    updatedAt: stopRequestedAt,
  }));

  for (const target of result.targets) {
    if (target.type !== 'service') {
      continue;
    }

    updateSessionService(sessionInfo.sessionDir, target.name, {
      status: 'stopped',
      endedAt: stopRequestedAt,
    });
  }

  if (result.targets.length === 0) {
    print(`Current session "${sessionInfo.session.sessionId || 'unknown'}" has no active runner or service processes.`);
    return;
  }

  const summary = result.targets
    .map((target) => `${target.name}(${target.pid})`)
    .join(', ');
  print(`Stop requested for current session "${sessionInfo.session.sessionId || 'unknown'}": ${summary}`);
}

function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'summary').toLowerCase();

  switch (command) {
    case 'summary':
      printSummary();
      return;
    case 'sessions':
      printSessions();
      return;
    case 'path':
      printPath(args[1]);
      return;
    case 'tail':
      printTail(args[1], args[2], args[3]);
      return;
    case 'stop':
      stopCurrentSession();
      return;
    case 'archive-legacy':
      printArchiveSummary(archiveLegacyRootLogs({ dryRun: args.includes('--dry-run') }));
      return;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
