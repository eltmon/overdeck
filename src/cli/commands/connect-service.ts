/**
 * The contract between `pan connect` and its platform service installers
 * (PAN-4656): `connect-systemd.ts` on Linux, `connect-launchd.ts` on macOS.
 * Types only, so the installers never import `connect.ts`.
 */

/** What the platform's service step did, and the lines that say so. */
export interface ServiceOutcome {
  manager: 'systemd' | 'launchd' | 'process';
  name: string | null;
  enabled: boolean;
  /** Printed after `Overdeck server: `. */
  line: string;
  linger: 'on' | 'off' | 'not-applicable';
  /** Printed on the line after the service line, when set. */
  note: string | null;
}

/** What a platform service installer gets from `pan connect`. */
export interface ServiceContext {
  env: NodeJS.ProcessEnv;
  user: string;
  isTTY: boolean;
  json: boolean;
  overdeckHome: string;
  /** A progress line: stdout in text mode, stderr with --json. */
  progress: (line: string) => void;
}
