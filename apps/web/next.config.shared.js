function isTruthyFlag(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function shouldDisableWebpackBuildWorker({
  env = {},
  workspaceEnv = {},
  platform = process.platform,
  nodeEnv = process.env.NODE_ENV || 'development',
} = {}) {
  const explicitDisable = isTruthyFlag(
    env.NEXT_DISABLE_BUILD_WORKER || workspaceEnv.NEXT_DISABLE_BUILD_WORKER,
  );

  const isCodexSandbox = Boolean(
    env.CODEX_THREAD_ID
    || env.CODEX_SANDBOX_NETWORK_DISABLED
    || workspaceEnv.CODEX_THREAD_ID
    || workspaceEnv.CODEX_SANDBOX_NETWORK_DISABLED,
  );

  const isWindowsDev = platform === 'win32' && nodeEnv !== 'production';

  return explicitDisable || isCodexSandbox || isWindowsDev;
}

module.exports = {
  shouldDisableWebpackBuildWorker,
};
