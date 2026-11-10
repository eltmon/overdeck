/** PAN-5108 harness CLI keys, split out of schema.ts (a god file that must not grow). Global config only. */
export interface HarnessesYamlConfig {
  /** Keep npm-installed harness CLIs current, and update Claude Code when a launch needs a newer one (default true). */
  auto_update?: boolean;
}

export interface NormalizedHarnessesConfig {
  autoUpdate: boolean;
}
