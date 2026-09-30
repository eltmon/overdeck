/**
 * The one loopback check for Overdeck Anywhere (PAN-4445 D-7).
 *
 * `pan pair` re-exports it as `isLoopbackBase`, and the Anywhere status route
 * uses it to tell addresses that work only on this machine from addresses
 * another device can reach. It has no imports, so `pan pair`'s startup-cost
 * rule (static imports limited to Commander types and chalk) still holds.
 */

/** True when the URL's host only resolves on this machine (was pan pair's isLoopbackBase). */
export function isLoopbackOrigin(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}
