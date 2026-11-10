/** PAN-5108: the `harnesses` block of the settings API, kept out of settings-api.ts (a god file). */

export interface ApiHarnessesConfig {
  /** Keep npm-installed coding-agent CLIs current (default true). Persists as `harnesses.auto_update`. */
  auto_update?: boolean;
}

export function validateHarnessesSettings(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push('harnesses must be an object');
    return;
  }
  const autoUpdate = (value as { auto_update?: unknown }).auto_update;
  if (autoUpdate !== undefined && typeof autoUpdate !== 'boolean') {
    errors.push('harnesses.auto_update must be a boolean');
  }
}
