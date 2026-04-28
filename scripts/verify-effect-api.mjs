#!/usr/bin/env node
import { readFile } from "node:fs/promises";

/**
 * Verify that the installed Effect package exports the APIs we depend on.
 * Fails fast if a beta bump removed or renamed something we use.
 *
 * Run after `bun install` and before `npm run build`.
 */

const effectRequired = [
  // Core runtime
  "Effect",
  "Layer",
  "Context",
  "Schema",
  "Stream",
  "Option",
  "Ref",
  "SubscriptionRef",
  "Queue",
  "PubSub",
  // Time / scheduling
  "Schedule",
  "Duration",
  // Error handling
  "Data",
  "Cause",
  // Services
  "ManagedRuntime",
  "Fiber",
];

// Note: @effect/platform-node uses wildcard exports ("./*"), so individual
// module availability is checked at build time by TypeScript. We focus on
// the core effect package where beta-to-beta API renames have happened.

const effect = await import("effect");
const missingEffect = effectRequired.filter((name) => !(name in effect));

if (missingEffect.length > 0) {
  console.error(`Missing effect exports: ${missingEffect.join(", ")}`);
  process.exit(1);
}

// Also verify Context.Service exists (the API we migrated to)
if (typeof effect.Context?.Service !== "function") {
  console.error("Context.Service is missing or not a function");
  process.exit(1);
}

const pkg = await import("effect/package.json", { with: { type: "json" } });
console.log(`OK: effect@${pkg.default.version} exports all required APIs`);
