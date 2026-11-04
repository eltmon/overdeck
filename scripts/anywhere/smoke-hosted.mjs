#!/usr/bin/env node
// smoke-hosted.mjs — checks a deployed overdeck.ai account and connect Worker pair (PAN-4776).
//
// What it checks (each step is named in the output; a failure prints "FAILED at step <name>: <why>"
// and exits 1):
//   1. account-health  GET <account>/healthz answers ok and "configured": true (GitHub OAuth secrets set).
//   2. device-code     POST <account>/oauth/device/code returns a user code and a verification_uri on
//                      the account host. This starts one device sign-in that nobody approves; it
//                      expires after 15 minutes and counts toward the 10-per-10-minutes limit.
//   3. connect-health  GET <connect>/healthz answers ok, "configured": true and "turn": true
//                      (TURN secrets set, so the relay can mint ICE servers).
//
// Usage: node scripts/anywhere/smoke-hosted.mjs [--account <url>] [--connect <url>]
// Defaults: https://account.overdeck.ai and https://connect.overdeck.ai. Against `wrangler dev`, pass
// the local URLs; a local connect Worker without TURN secrets fails step 3 by design.
import { randomUUID } from 'node:crypto';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1].replace(/\/+$/, '');
}

const ACCOUNT = arg('--account', 'https://account.overdeck.ai');
const CONNECT = arg('--connect', 'https://connect.overdeck.ai');

async function step(name, check) {
  try {
    const detail = await check();
    console.log(`ok   ${name}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    console.error(`FAILED at step ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}, not JSON: ${text.slice(0, 200)}`);
  }
}

await step('account-health', async () => {
  const body = await json(await fetch(`${ACCOUNT}/healthz`));
  if (body.ok !== true || body.configured !== true) throw new Error(`expected ok and configured, got ${JSON.stringify(body)}`);
  return JSON.stringify(body);
});

await step('device-code', async () => {
  const response = await fetch(`${ACCOUNT}/oauth/device/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ platform: 'linux-x64', environment_id: randomUUID() }),
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  if (typeof body.user_code !== 'string' || typeof body.verification_uri !== 'string') {
    throw new Error(`missing user_code or verification_uri in ${JSON.stringify(body)}`);
  }
  if (new URL(body.verification_uri).origin !== new URL(ACCOUNT).origin) {
    throw new Error(`verification_uri ${body.verification_uri} is not on ${ACCOUNT}`);
  }
  return `verification_uri ${body.verification_uri}`;
});

await step('connect-health', async () => {
  const body = await json(await fetch(`${CONNECT}/healthz`));
  if (body.ok !== true || body.configured !== true || body.turn !== true) {
    throw new Error(`expected ok, configured and turn, got ${JSON.stringify(body)}`);
  }
  return JSON.stringify(body);
});
