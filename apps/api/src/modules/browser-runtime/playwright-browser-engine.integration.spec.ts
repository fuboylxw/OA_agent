import * as http from 'http';
import * as fs from 'fs';
import type { AddressInfo } from 'net';
import type { RpaFlowDefinition } from '@uniflow/shared-types';
import { BrowserTaskRuntime } from './browser-task-runtime';

jest.setTimeout(30000);

function isPlaywrightBrowserAvailable(): boolean {
  try {
    const pw = require('playwright');
    const execPath = pw.chromium?.executablePath?.();
    return Boolean(execPath && fs.existsSync(execPath));
  } catch {
    return false;
  }
}

const describeIfPlaywright = isPlaywrightBrowserAvailable() ? describe : describe.skip;

describeIfPlaywright('BrowserTaskRuntime Playwright integration', () => {
  const templatePng = encodePng(2, 2, [
    [0, 0, 0, 255], [255, 255, 255, 255],
    [255, 255, 255, 255], [0, 0, 0, 255],
  ]);

  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/submit.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(templatePng);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Expense Draft</title>
    <style>
      body { font-family: sans-serif; padding: 24px; }
      #submit-by-image { border: 0; padding: 0; background: transparent; cursor: pointer; }
      #submit-by-image img { display: block; width: 24px; height: 24px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Expense Form</h1>
      <label for="amount">Amount</label>
      <input id="amount" name="amount" />
      <button id="submit-by-image" type="button" aria-label="Submit by Image"
        onclick="document.title='Expense Submitted'; document.getElementById('result').textContent='submitted';">
        <img src="/submit.png" alt="submit button image" />
      </button>
      <div id="result">draft</div>
    </main>
  </body>
</html>`);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('executes a submit flow with real Playwright and image template clicking', async () => {
    const runtime = new BrowserTaskRuntime();
    const result = await runtime.run({
      action: 'submit',
      flow: buildFlow(baseUrl, templatePng.toString('base64')),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'playwright',
        headless: true,
      },
      payload: {
        formData: {
          amount: '256',
        },
      },
      ticket: {
        jumpUrl: `${baseUrl}/form`,
      },
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('playwright');
    expect(result.warnings).toEqual([]);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({
        type: 'goto',
        status: 'executed',
      }),
      expect.objectContaining({
        type: 'input',
        status: 'executed',
        elementRef: expect.stringMatching(/^e\d+$/),
      }),
      expect.objectContaining({
        type: 'click',
        status: 'executed',
        targetKind: 'image',
      }),
    ]);
    expect(result.finalSnapshot?.title).toBe('Expense Submitted');
  });
});

function buildFlow(baseUrl: string, templateBase64: string): RpaFlowDefinition {
  return {
    processCode: 'expense_submit',
    processName: 'Expense Submit',
    fields: [
      {
        key: 'amount',
        label: 'Amount',
        type: 'text',
        required: true,
        selector: '#amount',
      },
    ],
    platform: {
      entryUrl: baseUrl,
      targetSystem: 'expense-oa',
    },
    runtime: {
      executorMode: 'browser',
      browserProvider: 'playwright',
      headless: true,
    },
    actions: {
      submit: {
        steps: [
          {
            type: 'goto',
            target: {
              kind: 'url',
              value: `${baseUrl}/form`,
            },
            description: 'Open form page',
          },
          {
            type: 'input',
            selector: '#amount',
            fieldKey: 'amount',
            description: 'Fill amount',
          },
          {
            type: 'click',
            description: 'Click image submit button',
            target: {
              kind: 'image',
              value: 'submit.png',
              imageUrl: `data:image/png;base64,${templateBase64}`,
              confidenceThreshold: 0.7,
            },
          },
        ],
      },
    },
  };
}

function encodePng(width: number, height: number, pixels: number[][]) {
  const { deflateSync } = require('zlib');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rawRows.push(0);
    for (let x = 0; x < width; x += 1) {
      rawRows.push(...pixels[y * width + x]);
    }
  }

  const idat = deflateSync(Buffer.from(rawRows));
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  return Buffer.concat([header, data, crc]);
}
