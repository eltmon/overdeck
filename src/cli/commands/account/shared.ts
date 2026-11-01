/**
 * Shared plumbing for the `pan account` verbs (PRD PAN-4330 D-14).
 *
 * Its own IO type, not `src/cli/commands/vault/shared.ts`'s `CliIo`: importing that module
 * would pull `src/lib/vault/**` into this command group's import graph (NFR-2). Tests reuse
 * `captureIo` from `tests/unit/cli/vault/helpers.ts`, a structurally compatible superset.
 */
import { exitCli } from '../../exit.js';

export interface AccountIo {
  out(line: string): void;
  err(line: string): void;
  exit(code: number): Promise<never>;
}

export const defaultAccountIo: AccountIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  exit: (code) => exitCli(code),
};
