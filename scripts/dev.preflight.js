const net = require('net');

const defaultPortsByApp = {
  api: 3001,
  web: 3000,
};

function resolveRequiredPorts(appPackages) {
  return appPackages
    .map((appPackage) => {
      const port = defaultPortsByApp[appPackage.name];
      if (!port) {
        return null;
      }

      return {
        appName: appPackage.name,
        port,
      };
    })
    .filter(Boolean);
}

function checkPortAvailable(port, { host = '0.0.0.0' } = {}) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    const cleanup = () => {
      server.removeAllListeners();
    };

    server.once('error', (error) => {
      cleanup();
      if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      server.close((error) => {
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

async function assertPortsAvailable(requiredPorts, options = {}) {
  const conflicts = [];

  for (const requiredPort of requiredPorts) {
    const available = await checkPortAvailable(requiredPort.port, options);
    if (!available) {
      conflicts.push(requiredPort);
    }
  }

  if (conflicts.length === 0) {
    return;
  }

  const details = conflicts
    .map(({ appName, port }) => `${appName}: port ${port} is already in use`)
    .join('; ');

  throw new Error(
    `Cannot start dev services because the required ports are unavailable: ${details}. `
      + 'Stop the existing process or free the port, then retry.',
  );
}

module.exports = {
  assertPortsAvailable,
  checkPortAvailable,
  resolveRequiredPorts,
};
