#!/usr/bin/env node
// fake-ssh.mjs — a stand-in for OpenSSH for the SSH machine smoke (PAN-4404 WI-13).
//
// ssh-machine-smoke.mjs installs it as `ssh` in .tmp/ssh-smoke/bin/ and puts that
// directory first on the linking dashboard's PATH. It understands exactly the two
// argv shapes of D-4404-5 and nothing else:
//
//   command:  -T -o BatchMode=yes … -- <dest> <remote command>
//             Runs <remote command> with `sh -c`, as sshd hands it to a login shell,
//             with HOME and OVERDECK_HOME set to FAKE_SSH_REMOTE_HOME and SHELL=/bin/sh.
//             Variables that point at the linking dashboard are removed first.
//   forward:  -o BatchMode=yes … -N -o ExitOnForwardFailure=yes
//             -L 127.0.0.1:<lp>:127.0.0.1:<rp> -- <dest>
//             Runs a TCP proxy from 127.0.0.1:<lp> to 127.0.0.1:<rp> until killed.
//             A taken <lp> prints OpenSSH's "Address already in use" line and exits 255.
//
// The destination is accepted but ignored: every destination is the one fake remote.
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';

const argv = process.argv.slice(2);
const remoteHome = process.env.FAKE_SSH_REMOTE_HOME;

function die(message) {
  process.stderr.write(`fake-ssh: ${message}\n`);
  process.exit(255);
}

if (!remoteHome) die('FAKE_SSH_REMOTE_HOME is not set');
const separator = argv.indexOf('--');
if (separator < 0) die(`no -- in argv: ${JSON.stringify(argv)}`);
const options = argv.slice(0, separator);
const [dest, ...rest] = argv.slice(separator + 1);
if (!dest) die('no destination after --');
for (let i = 0; i < options.length; i++) {
  const option = options[i];
  if (option === '-o') {
    const value = options[++i] ?? '';
    if (!/^(BatchMode=yes|ConnectTimeout=\d+|ServerAliveInterval=\d+|ServerAliveCountMax=\d+|ExitOnForwardFailure=yes)$/.test(value)) {
      die(`unexpected -o ${value}`);
    }
  } else if (option === '-L') {
    i++;
  } else if (option !== '-T' && option !== '-N') {
    die(`unexpected option ${option}`);
  }
}

if (options.includes('-N')) {
  const forward = options[options.indexOf('-L') + 1] ?? '';
  const match = /^127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)$/.exec(forward);
  if (!match || rest.length > 0) die(`unexpected forward argv: ${JSON.stringify(argv)}`);
  const localPort = Number(match[1]);
  const remotePort = Number(match[2]);
  const sockets = new Set();
  const server = createServer((client) => {
    const upstream = connect({ host: '127.0.0.1', port: remotePort });
    sockets.add(client);
    sockets.add(upstream);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', drop).on('close', drop);
    upstream.on('error', drop).on('close', drop);
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(`bind [127.0.0.1]:${localPort}: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: ${localPort}\n`);
    } else {
      process.stderr.write(`fake-ssh: ${error.message}\n`);
    }
    process.exit(255);
  });
  server.listen(localPort, '127.0.0.1');
  const stop = () => {
    for (const socket of sockets) socket.destroy();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  if (!options.includes('-T') || rest.length !== 1) die(`unexpected command argv: ${JSON.stringify(argv)}`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OVERDECK_') || key === 'API_PORT' || key === 'PORT' || key === 'DASHBOARD_URL') delete env[key];
  }
  delete env.FAKE_SSH_REMOTE_HOME;
  const child = spawn('sh', ['-c', rest[0]], {
    env: { ...env, HOME: remoteHome, OVERDECK_HOME: remoteHome, SHELL: '/bin/sh' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 255 : 0)));
  child.on('error', (error) => die(error.message));
}
