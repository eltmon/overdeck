/** Build-time settings of the phone app (PAN-4837 C-9, D-8a). */
import pkg from '../../package.json';

const env = import.meta.env as Record<string, string | undefined>;

/** overdeck.ai account service; override with `VITE_OVERDECK_ACCOUNT_URL` for a staging or local stack. */
export const ACCOUNT_BASE_URL = env.VITE_OVERDECK_ACCOUNT_URL ?? 'https://account.overdeck.ai';
/** overdeck.ai directory; override with `VITE_OVERDECK_DIRECTORY_URL`. */
export const DIRECTORY_BASE_URL = env.VITE_OVERDECK_DIRECTORY_URL ?? 'https://connect.overdeck.ai';
export const APP_VERSION: string = pkg.version;
/** `VITE_OVERDECK_DEBUG_ERRORS=1` appends the error code to a failed link's text, e.g. ` (timeout)` (PAN-5018 D-2). */
export const DEBUG_ERRORS = env.VITE_OVERDECK_DEBUG_ERRORS === '1';
/**
 * The oldest pan release with the phone credential (PAN-4835). No tag contained its merge when
 * this was set, so it is the next minor after 0.73.1 (D-8a).
 */
export const MIN_PAN_VERSION = '0.74.0';
export const NATIVE_REDIRECT = 'ai.overdeck.app:/oauth/callback';
