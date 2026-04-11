const { shouldDisableWebpackBuildWorker } = require('./next.config.shared');

describe('shouldDisableWebpackBuildWorker', () => {
  it('disables the build worker in Codex sandbox environments', () => {
    expect(
      shouldDisableWebpackBuildWorker({
        env: { CODEX_THREAD_ID: 'thread-123' },
        workspaceEnv: {},
        platform: 'linux',
        nodeEnv: 'development',
      }),
    ).toBe(true);
  });

  it('disables the build worker for windows dev even when sandbox env is missing', () => {
    expect(
      shouldDisableWebpackBuildWorker({
        env: {},
        workspaceEnv: {},
        platform: 'win32',
        nodeEnv: 'development',
      }),
    ).toBe(true);
  });

  it('does not disable the build worker for non-sandbox production by default', () => {
    expect(
      shouldDisableWebpackBuildWorker({
        env: {},
        workspaceEnv: {},
        platform: 'linux',
        nodeEnv: 'production',
      }),
    ).toBe(false);
  });
});
