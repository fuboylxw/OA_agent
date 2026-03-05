import { detectCapabilities } from '../capability-detector';

describe('Capability Detector', () => {
  it('should detect API capabilities from OpenAPI spec', () => {
    const mockSpec = {
      paths: {
        '/auth/login': {
          post: {
            tags: ['auth'],
            summary: 'Login',
          },
        },
        '/flows': {
          get: {
            tags: ['flows'],
            summary: 'List flows',
          },
        },
        '/flows/{flowCode}/submit': {
          post: {
            tags: ['flows'],
            summary: 'Submit flow',
          },
        },
        '/flows/{flowCode}/status/{id}': {
          get: {
            tags: ['flows'],
            summary: 'Query status',
          },
        },
      },
    };

    const result = detectCapabilities({
      openApiSpec: mockSpec,
    });

    expect(result.hasApi).toBe(true);
    expect(result.hasOpenApi).toBe(true);
    expect(result.hasAuth).toBe(true);
    expect(result.canReadFlows).toBe(true);
    expect(result.canSubmit).toBe(true);
    expect(result.canReadStatus).toBe(true);
    expect(result.detectedEndpoints.length).toBeGreaterThan(0);
  });

  it('should detect capabilities from HAR entries', () => {
    const mockHar = [
      {
        url: 'http://example.com/api/auth/token',
        method: 'POST',
        requestHeaders: { authorization: 'Bearer xxx' },
        responseStatus: 200,
      },
      {
        url: 'http://example.com/api/flows',
        method: 'GET',
        requestHeaders: {},
        responseStatus: 200,
      },
      {
        url: 'http://example.com/api/flows/test/submit',
        method: 'POST',
        requestHeaders: {},
        responseStatus: 201,
      },
    ];

    const result = detectCapabilities({
      harEntries: mockHar,
    });

    expect(result.hasApi).toBe(true);
    expect(result.hasAuth).toBe(true);
    expect(result.canReadFlows).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it('should detect form-based capabilities', () => {
    const mockPages = [
      {
        url: 'http://example.com/forms/submit',
        html: '<html></html>',
        forms: [
          {
            action: '/forms/submit',
            method: 'POST',
            fields: [
              { name: 'title', type: 'text', required: true },
              { name: 'amount', type: 'number', required: true },
            ],
          },
        ],
      },
    ];

    const result = detectCapabilities({
      htmlPages: mockPages,
    });

    expect(result.canSubmit).toBe(true);
    expect(result.detectedForms.length).toBeGreaterThan(0);
    expect(result.detectedForms[0].fields.length).toBe(2);
  });

  it('should handle empty input', () => {
    const result = detectCapabilities({});

    expect(result.hasApi).toBe(false);
    expect(result.hasOpenApi).toBe(false);
    expect(result.detectedEndpoints.length).toBe(0);
    expect(result.detectedForms.length).toBe(0);
  });
});
