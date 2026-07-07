#!/usr/bin/env node
/**
 * canonicalize-circular-deps.js — helper for lint-circular-deps.sh.
 * Reads madge --circular --json output from stdin and emits one canonical
 * cycle per line. Each path is prefixed with src/ and the cycle is sorted
 * so madge's rotation/order differences do not create noise.
 */
let d = "";
process.stdin.on("data", c => d += c).on("end", () => {
  const cycles = JSON.parse(d || "[]");
  const out = [...new Set(cycles.map(cycle => {
    const normalized = cycle.map(p => "src/" + (p.startsWith("./") ? p.slice(2) : p));
    // Rotate to start at the lexicographically smallest member so the same
    // directed cycle reported from different starting points canonicalizes to
    // one line, but distinct directed cycles with the same member set are kept
    // separate (unlike sorting, which would collapse them).
    const min = normalized.reduce((a, b) => (a < b ? a : b));
    const minIndex = normalized.indexOf(min);
    const rotated = [...normalized.slice(minIndex), ...normalized.slice(0, minIndex)];
    return rotated.join(" > ");
  }))].sort();
  console.log(out.join("\n"));
});
