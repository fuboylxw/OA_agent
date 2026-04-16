import type { BrowserTaskRequest } from './browser-runtime.types';
import { BrowserSessionManager } from './browser-session-manager';

describe('BrowserSessionManager', () => {
  const originalDisplay = process.env.DISPLAY;
  const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
  const originalMirSocket = process.env.MIR_SOCKET;
  const originalForceHeadless = process.env.BROWSER_RUNTIME_FORCE_HEADLESS;

  afterEach(() => {
    restoreEnv('DISPLAY', originalDisplay);
    restoreEnv('WAYLAND_DISPLAY', originalWaylandDisplay);
    restoreEnv('MIR_SOCKET', originalMirSocket);
    restoreEnv('BROWSER_RUNTIME_FORCE_HEADLESS', originalForceHeadless);
  });

  it('keeps headed mode when a display server is available', () => {
    process.env.DISPLAY = ':99';
    const manager = new BrowserSessionManager();

    const session = manager.createSession(
      buildRequest(false),
      'playwright',
      'playwright',
    );

    expect(session.headless).toBe(false);
    expect(session.warnings).toEqual([]);
  });

  it('falls back to headless mode when headed execution has no display server', () => {
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.MIR_SOCKET;
    const manager = new BrowserSessionManager();

    const session = manager.createSession(
      buildRequest(false),
      'playwright',
      'playwright',
    );

    expect(session.headless).toBe(true);
    expect(session.warnings).toEqual([
      expect.objectContaining({
        code: 'browser_runtime_missing_display',
      }),
    ]);
  });

  it('forces headless mode when the runtime override is enabled', () => {
    process.env.DISPLAY = ':99';
    process.env.BROWSER_RUNTIME_FORCE_HEADLESS = 'true';
    const manager = new BrowserSessionManager();

    const session = manager.createSession(
      buildRequest(false),
      'playwright',
      'playwright',
    );

    expect(session.headless).toBe(true);
    expect(session.warnings).toEqual([
      expect.objectContaining({
        code: 'browser_runtime_force_headless',
      }),
    ]);
  });
});

function buildRequest(headless: boolean): BrowserTaskRequest {
  return {
    action: 'submit' as const,
    flow: {
      processCode: 'leave_request',
      processName: '请假申请',
      platform: {
        entryUrl: 'https://sz.xpu.edu.cn/',
      },
    },
    runtime: {
      headless,
      browserProvider: 'playwright' as const,
    },
    payload: {},
    ticket: {
      jumpUrl: 'https://sz.xpu.edu.cn/',
    },
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
