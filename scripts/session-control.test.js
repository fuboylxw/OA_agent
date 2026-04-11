const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStopTargets, stopSessionProcesses } = require('./session-control');

test('resolveStopTargets prefers the runner process when it is alive', () => {
  const session = {
    runnerPid: 5000,
    services: {
      api: { pid: 3001, status: 'running' },
      web: { pid: 3000, status: 'running' },
    },
  };

  const targets = resolveStopTargets(session, {
    isProcessAlive: (pid) => pid === 5000,
  });

  assert.deepEqual(targets, [
    { type: 'runner', name: 'runner', pid: 5000 },
  ]);
});

test('resolveStopTargets falls back to running service pids when runner is not alive', () => {
  const session = {
    runnerPid: 5000,
    services: {
      api: { pid: 3001, status: 'running' },
      web: { pid: 3000, status: 'running' },
      worker: { pid: 3999, status: 'stopped' },
      bad: { pid: 'oops', status: 'running' },
    },
  };

  const targets = resolveStopTargets(session, {
    isProcessAlive: (pid) => pid !== 5000,
  });

  assert.deepEqual(targets, [
    { type: 'service', name: 'api', pid: 3001 },
    { type: 'service', name: 'web', pid: 3000 },
  ]);
});

test('stopSessionProcesses stops each resolved target once', () => {
  const session = {
    runnerPid: 5000,
    services: {
      api: { pid: 3001, status: 'running' },
    },
  };
  const stopped = [];

  const result = stopSessionProcesses(session, {
    isProcessAlive: (pid) => pid === 3001,
    stopProcess: (pid) => {
      stopped.push(pid);
    },
  });

  assert.deepEqual(stopped, [3001]);
  assert.deepEqual(result.targets, [
    { type: 'service', name: 'api', pid: 3001 },
  ]);
});
