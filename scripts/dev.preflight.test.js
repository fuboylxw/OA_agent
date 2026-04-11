const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { assertPortsAvailable, resolveRequiredPorts } = require('./dev.preflight');

test('resolveRequiredPorts returns fixed ports for api and web apps', () => {
  const requiredPorts = resolveRequiredPorts([
    { name: 'worker' },
    { name: 'api' },
    { name: 'web' },
  ]);

  assert.deepEqual(requiredPorts, [
    { appName: 'api', port: 3001 },
    { appName: 'web', port: 3000 },
  ]);
});

test('assertPortsAvailable rejects with the conflicting app and port', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    await assert.rejects(
      () => assertPortsAvailable([{ appName: 'web', port: address.port }], { host: '127.0.0.1' }),
      /web: port \d+ is already in use/i,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
