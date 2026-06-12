import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let warningFilterInstalled = false;

function installSqliteWarningFilter() {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;

  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...args) => {
    const message = typeof warning === 'string' ? warning : warning?.message;
    const warningName = typeof args[0] === 'string' ? args[0] : args[0]?.type ?? warning?.name;

    if (warningName === 'ExperimentalWarning' && typeof message === 'string' && /SQLite/.test(message)) {
      return;
    }

    return originalEmitWarning(warning, ...args);
  };
}

export function openNodeSqliteDatabase(path) {
  installSqliteWarningFilter();
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(path);
}
