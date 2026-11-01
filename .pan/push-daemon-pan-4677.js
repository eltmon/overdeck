const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function log(message) {
  try {
    fs.appendFileSync("/workspace/.pan/push-daemon-pan-4677.log", '[' + new Date().toISOString() + '] ' + message + '\n');
  } catch {}
}

function runOnce() {
  const cwd = '/workspace';
  try {
    if (!fs.existsSync(path.join(cwd, '.git'))) {
      log('Not a git repository; skipping heartbeat');
      return;
    }
  } catch (err) {
    log('Error checking repository: ' + (err && err.message ? err.message : String(err)));
    return;
  }

  execFile('git', ['-C', cwd, 'add', '-A'], (err) => {
    if (err) {
      log('git add failed: ' + (err.message || String(err)));
      return;
    }
    execFile('git', ['-C', cwd, 'diff', '--cached', '--quiet'], (err) => {
      if (!err) {
        return;
      }
      const message = 'wip(remote): heartbeat for ' + "PAN-4677";
      execFile(
        'git',
        ['-C', cwd, '-c', 'user.name=Overdeck Remote', '-c', 'user.email=remote@overdeck.local', 'commit', '-m', message],
        (err) => {
          if (err) {
            log('git commit failed: ' + (err.message || String(err)));
            return;
          }
          execFile('git', ['-C', cwd, 'push', 'origin', "feature/pan-4677"], (err) => {
            if (err) {
              log('git push failed: ' + (err.message || String(err)));
            }
          });
        }
      );
    });
  });
}

function runHeartbeat(config) {
  runOnce();
  setInterval(runOnce, config.intervalSeconds * 1000);
}

if (require.main === module) {
  runHeartbeat({
    intervalSeconds: Number(process.env.PAN_INTERVAL_SECONDS || '300'),
  });
}

module.exports = { runHeartbeat };