const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nodeDir = path.dirname(process.execPath);
const corepackShimsDir = path.join(nodeDir, 'node_modules', 'corepack', 'shims');

const env = {
  ...process.env,
  COREPACK_HOME: process.env.COREPACK_HOME || path.join(rootDir, '.corepack'),
  PATH: [corepackShimsDir, nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/run-turbo.js <task> [...extraArgs]');
  process.exit(1);
}

const child = spawn('turbo', ['run', ...args], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`[turbo] failed to start: ${error.message}`);
  process.exit(1);
});
