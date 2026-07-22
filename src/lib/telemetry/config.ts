import { loadConfigSync } from '../config-yaml.js';

export function resolveTelemetryEnabled(): boolean {
  const envValue = process.env.OVERDECK_TELEMETRY?.trim().toLowerCase();
  if (envValue === '0' || envValue === 'false') return false;

  return loadConfigSync().config.telemetry?.enabled !== false;
}
