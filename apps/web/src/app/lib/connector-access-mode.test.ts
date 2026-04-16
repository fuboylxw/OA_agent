import {
  formatExecutionModes,
  resolveAccessModeFromAuthConfig,
  resolvePublishedAccessMode,
} from './connector-access-mode';

describe('connector-access-mode', () => {
  it('prefers url mode when executionModes exposes url', () => {
    expect(resolvePublishedAccessMode({
      uiHints: {
        executionModes: {
          submit: ['url'],
          queryStatus: ['url'],
        },
        rpaDefinition: {
          runtime: {
            networkSubmit: {
              url: 'https://oa.example.com/seeyon/save.do',
            },
          },
        },
      },
      authConfig: {
        accessMode: 'text_guide',
      },
    })).toBe('direct_link');
  });

  it('keeps text guide when the template explicitly marks text_guide source', () => {
    expect(resolvePublishedAccessMode({
      uiHints: {
        rpaSourceType: 'text_guide',
        rpaDefinition: {
          sourceType: 'text_guide',
        },
      },
    })).toBe('text_guide');
  });

  it('falls back to authConfig when only connector bootstrap metadata exists', () => {
    expect(resolvePublishedAccessMode({
      authConfig: {
        accessMode: 'direct_link',
        bootstrapMode: 'rpa_only',
      },
    })).toBe('direct_link');
    expect(resolveAccessModeFromAuthConfig({
      bootstrapMode: 'api_only',
    })).toBe('backend_api');
  });

  it('formats execution modes with user-facing labels', () => {
    expect(formatExecutionModes({
      executionModes: {
        submit: ['url', 'api'],
        queryStatus: ['rpa'],
      },
    })).toBe('提交：URL 直达 / API；状态：浏览器自动化');
  });
});
