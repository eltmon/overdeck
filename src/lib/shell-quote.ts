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

/**
 * Quote one argv element only when the shell would split or expand it, so a
 * plain `bash /path/launcher.sh` stays byte-identical and a path with a space
 * still reaches bash as one argument.
 */
export function shellQuoteArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : shellQuote(value);
}
