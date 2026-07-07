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
  const out = cycles.map(cycle => {
    const normalized = cycle.map(p => "src/" + (p.startsWith("./") ? p.slice(2) : p)).sort();
    return normalized.join(" > ");
  }).sort();
  console.log(out.join("\n"));
});
