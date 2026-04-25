import {
  API_DELIVERY_PATH,
  URL_DELIVERY_PATH,
  VISION_DELIVERY_PATH,
} from '@uniflow/shared-types';
import { buildExecutionOrder, resolveAvailablePaths } from './delivery-path-resolver';

describe('delivery-path-resolver', () => {
  it('prefers api and vision without inferring url from browser steps', () => {
    const paths = resolveAvailablePaths({
      executionModes: {
        submit: ['api', 'rpa'],
      },
      rpaDefinition: {
        processCode: 'leave_apply',
        processName: 'Leave Apply',
        platform: {
          entryUrl: 'https://oa.example.com/leave',
        },
        actions: {
          submit: {
            steps: [{
              type: 'click',
              selector: '#submit',
            }],
          },
        },
      },
    }, 'submit');

    expect(paths).toEqual([API_DELIVERY_PATH, VISION_DELIVERY_PATH]);
  });

  it('keeps selected path first and appends remaining fallbacks without duplication', () => {
    const order = buildExecutionOrder(
      VISION_DELIVERY_PATH,
      [URL_DELIVERY_PATH],
      [API_DELIVERY_PATH, VISION_DELIVERY_PATH, URL_DELIVERY_PATH],
    );
    expect(order).toEqual([VISION_DELIVERY_PATH, URL_DELIVERY_PATH, API_DELIVERY_PATH]);
  });

  it('does not append undeclared fallback paths', () => {
    const order = buildExecutionOrder(
      API_DELIVERY_PATH,
      [VISION_DELIVERY_PATH, URL_DELIVERY_PATH],
      [API_DELIVERY_PATH],
    );
    expect(order).toEqual([API_DELIVERY_PATH]);
  });

  it('filters unknown explicit fallback entries before building the available path list', () => {
    const paths = resolveAvailablePaths({
      delivery: {
        fallbackOrder: [VISION_DELIVERY_PATH, 'manual', URL_DELIVERY_PATH],
        vision: {
          available: true,
          submitEnabled: true,
          queryEnabled: true,
          health: 'healthy',
        },
        url: {
          available: true,
          submitEnabled: true,
          queryEnabled: true,
          health: 'healthy',
        },
      },
    }, 'submit');

    expect(paths).toEqual([VISION_DELIVERY_PATH, URL_DELIVERY_PATH]);
  });

  it('includes url when only networkSubmit is configured under runtime', () => {
    const paths = resolveAvailablePaths({
      rpaDefinition: {
        processCode: 'leave_apply_url_network',
        processName: 'Leave Apply URL Network',
        accessMode: 'direct_link',
        sourceType: 'direct_link',
        platform: {
          jumpUrlTemplate: 'https://oa.example.com/workflow/{processCode}',
        },
        runtime: {
          networkSubmit: {
            url: 'https://oa.example.com/api/workflow/submit',
          },
        },
      },
    }, 'submit');

    expect(paths).toEqual([URL_DELIVERY_PATH]);
  });

  it('prefers runtimeManifest capability paths over legacy executionModes', () => {
    const paths = resolveAvailablePaths({
      runtimeManifest: {
        version: 1,
        capabilities: {
          submit: ['url'],
          queryStatus: [],
        },
        definition: {
          processCode: 'manifest_first_flow',
          processName: 'Manifest First Flow',
          accessMode: 'direct_link',
          sourceType: 'direct_link',
          platform: {
            jumpUrlTemplate: 'https://oa.example.com/workflow/manifest_first_flow',
          },
          runtime: {
            networkSubmit: {
              url: 'https://oa.example.com/api/workflow/submit',
            },
          },
        },
      },
      executionModes: {
        submit: ['rpa'],
      },
      rpaDefinition: {
        processCode: 'manifest_first_flow',
        processName: 'Legacy Flow',
        actions: {
          submit: {
            steps: [{ type: 'click', selector: '#submit' }],
          },
        },
      },
    }, 'submit');

    expect(paths).toEqual([URL_DELIVERY_PATH]);
  });
});
