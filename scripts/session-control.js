const { spawnSync } = require('child_process');

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

function stopProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid pid: ${pid}`);
  }

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      shell: true,
    });

    if (result.status !== 0) {
      const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(details || `taskkill failed for pid ${pid}`);
    }
    return;
  }

  process.kill(pid, 'SIGTERM');
}

function resolveStopTargets(session, { isProcessAlive: checkAlive = isProcessAlive } = {}) {
  const runnerPid = session?.runnerPid;
  if (Number.isInteger(runnerPid) && runnerPid > 0 && checkAlive(runnerPid)) {
    return [
      { type: 'runner', name: 'runner', pid: runnerPid },
    ];
  }

  return Object.entries(session?.services || {})
    .map(([serviceName, service]) => ({
      type: 'service',
      name: serviceName,
      pid: service?.pid,
      status: service?.status,
    }))
    .filter((target) => Number.isInteger(target.pid) && target.pid > 0)
    .filter((target) => target.status === 'running')
    .filter((target) => checkAlive(target.pid))
    .map(({ type, name, pid }) => ({ type, name, pid }));
}

function stopSessionProcesses(
  session,
  {
    isProcessAlive: checkAlive = isProcessAlive,
    stopProcess: terminateProcess = stopProcess,
  } = {},
) {
  const targets = resolveStopTargets(session, { isProcessAlive: checkAlive });

  for (const target of targets) {
    terminateProcess(target.pid);
  }

  return { targets };
}

module.exports = {
  isProcessAlive,
  resolveStopTargets,
  stopProcess,
  stopSessionProcesses,
};
