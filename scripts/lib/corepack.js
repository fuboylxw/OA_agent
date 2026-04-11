const fs = require('fs');
const path = require('path');

function resolveCorepackShimsDir() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    process.env.COREPACK_SHIMS_DIR,
    path.join(nodeDir, 'node_modules', 'corepack', 'shims'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'corepack', 'shims'),
    path.join(nodeDir, '..', 'node_modules', 'corepack', 'shims'),
    path.join(nodeDir, 'corepack', 'shims'),
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function prependCorepackToPath(existingPath = process.env.PATH) {
  const nodeDir = path.dirname(process.execPath);
  return [resolveCorepackShimsDir(), nodeDir, existingPath].filter(Boolean).join(path.delimiter);
}

module.exports = {
  prependCorepackToPath,
  resolveCorepackShimsDir,
};
