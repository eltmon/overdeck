/**
 * Quote a string for safe use as a shell literal in single quotes.
 * e.g. shellQuote("foo'bar") → "'foo'\\''bar'"
 *
 * Leaf module (PAN-3300) so launcher-generator.ts and the launcher command
 * builders extracted out of it share one implementation.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
