/** PAN-4565: a fresh start never has a handoff document, so its title comes
 * straight from the focus — never from the parent's title, and never
 * prefixed "Handoff:" like a normal handoff fork.
 */
export function freshStartTitle(focus: string | undefined): string {
  const f = focus?.replace(/\s+/g, ' ').trim();
  if (!f) return 'New conversation';
  return f.length > 70 ? `${f.slice(0, 69).trimEnd()}…` : f;
}
