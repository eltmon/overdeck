/** Every refusal or failure `pan computer` can report (PAN-5452). */
export type ComputerUseErrorCode =
  | 'disabled'
  | 'unsupported_platform'
  | 'no_desktop_session'
  | 'helper_missing_dependency'
  | 'helper_timeout'
  | 'helper_error'
  | 'desktop_busy'
  | 'element_not_found'
  | 'system_shortcut_blocked'
  | 'invalid_argument'
  | 'wait_timeout';

export class ComputerUseError extends Error {
  constructor(
    readonly code: ComputerUseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ComputerUseError';
  }
}

export function isComputerUseError(value: unknown): value is ComputerUseError {
  return value instanceof ComputerUseError;
}
