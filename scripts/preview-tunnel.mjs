import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { connect as connectTcp } from 'node:net';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { privatePreviewDirectory } from './start-project-preview.mjs';
const root = resolve(process.cwd());
const { Client } = createRequire(join(root, 'package.json'))('ssh2');
const stateDir = privatePreviewDirectory(root);
for (const name of ['id_rsa', 'host_sha256', 'srv.json'])
  if (existsSync(join(stateDir, name)) && lstatSync(join(stateDir, name)).isSymbolicLink())
    throw Error('Preview state symlink refused');
const config = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8'));
if (
  basename(root) !== config.projectName ||
  basename(resolve(root, '..')) !== 'Projects' ||
  config.projectPath !== `Projects/${config.projectName}`
)
  throw Error('Unexpected preview project');
const expiry = Date.parse(config.expiresAt);
if (
  !Number.isFinite(expiry) ||
  !Number.isInteger(config.webPort) ||
  config.webPort < 1024 ||
  config.webPort > 65535 ||
  expiry <= Date.now() ||
  expiry - Date.now() > 8 * 3600000
)
  throw Error('Invalid preview lease');
const keyPath = join(stateDir, 'id_rsa');
if (!existsSync(keyPath))
  writeFileSync(
    keyPath,
    generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
    { mode: 0o600, flag: 'wx' },
  );
const privateKey = readFileSync(keyPath);
const pinPath = join(stateDir, 'host_sha256');
let client,
  ending = false,
  retryTimer,
  publicUrl;
const save = (state) =>
  writeFileSync(
    join(stateDir, 'srv.json'),
    JSON.stringify({
      state,
      url: publicUrl,
      relay: 'srv.us',
      webPort: config.webPort,
      expiresAt: config.expiresAt,
      applicationId: config.applicationId,
      projectPath: config.projectPath,
      pid: process.pid,
      at: new Date().toISOString(),
    }) + '\n',
    { mode: 0o600 },
  );
function stop() {
  if (ending) return;
  ending = true;
  clearTimeout(retryTimer);
  client?.end();
  save('stopped');
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('SIGUSR2', () => {
  if (!ending) client?.end();
});
setTimeout(stop, Math.max(1, expiry - Date.now())).unref();
function start() {
  if (ending || Date.now() >= expiry) return stop();
  save('connecting');
  const connection = new Client();
  client = connection;
  connection.on('ready', () => {
    process.stdout.write(JSON.stringify({ stage: 'ssh_ready' }) + '\n');
    connection.shell(false, (error, stream) => {
      if (error) {
        process.stderr.write(
          JSON.stringify({ stage: 'shell_error', code: error.code ?? 'ssh_shell_error' }) + '\n',
        );
        return connection.end();
      }
      let messages = '';
      stream.on('data', (chunk) => {
        messages = (messages + chunk.toString()).slice(-16384);
        const found = messages.match(/https:\/\/([a-z2-7]{26}\.srv\.us)\//);
        if (found) {
          publicUrl = found[0].slice(0, -1);
          save('ready');
          process.stdout.write(
            JSON.stringify({ url: publicUrl, expiresAt: config.expiresAt }) + '\n',
          );
        }
      });
      stream.on('error', () => connection.end());
    });
    connection.forwardIn('localhost', 1, (error) => {
      process.stdout.write(
        JSON.stringify({ stage: 'forward_reply', code: error ? 'ssh_forward_error' : 'ok' }) + '\n',
      );
      if (error) connection.end();
    });
  });
  connection.on('tcp connection', (details, accept, reject) => {
    if (ending || Date.now() >= expiry || details.destPort !== 1) return reject();
    const channel = accept();
    const socket = connectTcp({ host: '127.0.0.1', port: config.webPort });
    channel.on('error', () => socket.destroy());
    socket.on('error', () => channel.destroy());
    channel.pipe(socket);
    socket.pipe(channel);
  });
  connection.on('error', (error) => {
    process.stderr.write(
      JSON.stringify({ state: 'connection_error', code: error.code ?? 'ssh_error' }) + '\n',
    );
  });
  connection.on('close', () => {
    process.stdout.write(JSON.stringify({ stage: 'ssh_closed' }) + '\n');
    if (!ending) {
      save('reconnecting');
      retryTimer = setTimeout(start, 5000);
    }
  });
  connection.connect({
    host: 'srv.us',
    port: 22,
    username: 'nomatch',
    privateKey,
    keepaliveInterval: 5000,
    keepaliveCountMax: 3,
    readyTimeout: 20000,
    hostHash: 'sha256',
    hostVerifier: (hash) => {
      if (existsSync(pinPath)) return readFileSync(pinPath, 'utf8').trim() === hash;
      writeFileSync(pinPath, hash + '\n', { mode: 0o600, flag: 'wx' });
      return true;
    },
  });
}
start();
