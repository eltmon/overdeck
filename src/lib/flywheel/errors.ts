/**
 * Typed flywheel action errors (PAN-3964 FR-5). The CLI maps each to exit 1
 * with its message; the routes map `FlywheelAlreadyRunning` and
 * `FlywheelPausedExists` to 409 and `FlywheelNotRunning` to 404.
 */

import { FLYWHEEL_CONVERSATION_SESSION } from './constants.js';

export class FlywheelAlreadyRunning extends Error {
  readonly _tag = 'FlywheelAlreadyRunning';
  constructor() {
    super(`The flywheel is already running (${FLYWHEEL_CONVERSATION_SESSION}) — \`pan flywheel stop\` first`);
    this.name = 'FlywheelAlreadyRunning';
  }
}

export class FlywheelPausedExists extends Error {
  readonly _tag = 'FlywheelPausedExists';
  constructor() {
    super('paused flywheel exists — `pan flywheel resume` to continue, `pan flywheel start --fresh` to start over');
    this.name = 'FlywheelPausedExists';
  }
}

export class FlywheelNotRunning extends Error {
  readonly _tag = 'FlywheelNotRunning';
  constructor(message = 'The flywheel is not running') {
    super(message);
    this.name = 'FlywheelNotRunning';
  }
}

export type FlywheelActionError = FlywheelAlreadyRunning | FlywheelPausedExists | FlywheelNotRunning;

export function isFlywheelActionError(error: unknown): error is FlywheelActionError {
  return error instanceof FlywheelAlreadyRunning || error instanceof FlywheelPausedExists || error instanceof FlywheelNotRunning;
}
