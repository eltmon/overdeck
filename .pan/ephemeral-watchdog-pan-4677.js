const fs = require('fs');
const { execFile } = require('child_process');

function log(message) {
  try {
    fs.appendFileSync("/workspace/.pan/ephemeral-watchdog-pan-4677.log", '[' + new Date().toISOString() + '] ' + message + '\n');
  } catch {}
}

function stopMachine() {
  log('Host heartbeat stale — stopping machine (kill 1)');
  execFile('kill', ['1'], () => {});
}

function checkHeartbeat(config) {
  try {
    if (!fs.existsSync("/workspace/.pan/host-heartbeat")) {
      log('Heartbeat file not present yet; waiting for host');
      return;
    }
    const stat = fs.statSync("/workspace/.pan/host-heartbeat");
    const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSeconds > config.staleThresholdSeconds) {
      log(`Heartbeat stale: ${Math.round(ageSeconds)}s > ${config.staleThresholdSeconds}s`);
      stopMachine();
    } else {
      log(`Heartbeat fresh: ${Math.round(ageSeconds)}s <= ${config.staleThresholdSeconds}s`);
    }
  } catch (err) {
    log('Error checking heartbeat: ' + (err && err.message ? err.message : String(err)));
  }
}

function runWatchdog(config) {
  checkHeartbeat(config);
  setInterval(() => checkHeartbeat(config), config.intervalSeconds * 1000);
}

if (require.main === module) {
  runWatchdog({
    intervalSeconds: Number(process.env.PAN_WATCHDOG_INTERVAL_SECONDS || '60'),
    staleThresholdSeconds: Number(process.env.PAN_WATCHDOG_STALE_SECONDS || '300'),
  });
}

module.exports = { runWatchdog, checkHeartbeat, stopMachine };