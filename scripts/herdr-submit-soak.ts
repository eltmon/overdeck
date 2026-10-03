/**
 * herdr-submit-soak.ts (PAN-4492, D11)
 *
 * Reproduction and AC-1 soak for the Herdr submit-verification routine
 * (`pasteAndSubmitHerdrPane`, `src/lib/terminal-backends/herdr-submit.ts`).
 * Sends N messages of a given size to a live Claude Code conversation
 * through the real delivery door (`deliverAgentMessage`) and reports how
 * many landed as a transcript user record, and how many needed a resubmit
 * (visible as `[herdr-submit]` lines on stderr — the routine logs to
 * `console.warn` in-process).
 *
 * Usage:
 *   npx tsx scripts/herdr-submit-soak.ts --conv <conversation-name> \
 *     --cwd <conversation cwd> --session <claudeSessionId> \
 *     [--count 20] [--bytes 5120] [--tail "<last line>"]
 */

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';

import { deliverAgentMessage } from '../src/lib/agents/delivery.js';
import { captureTranscriptUserRecordSnapshot, probeTranscriptSince } from '../src/lib/transcript-landing.js';
import { herdrBackend } from '../src/lib/terminal-backends/herdr.js';

const DEFAULT_TAIL = 'Reply with exactly: ok';
const PROBE_INTERVAL_MS = 1_000;
const PROBE_TIMEOUT_MS = 60_000;
const AGENT_SETTLE_TIMEOUT_MS = 180_000;
const FILLER_LINE_CHARS = 64;

interface Args {
  conv: string;
  cwd: string;
  session: string;
  count: number;
  bytes: number;
  tail: string;
}

const USAGE = 'Usage: npx tsx scripts/herdr-submit-soak.ts --conv <name> --cwd <cwd> --session <id> [--count 20] [--bytes 5120] [--tail "<last line>"]';

function parseArgs(argv: string[]): Args {
  if (argv.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }

  let conv: string | undefined;
  let cwd: string | undefined;
  let session: string | undefined;
  let count = 20;
  let bytes = 5_120;
  let tail = DEFAULT_TAIL;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === '--conv') conv = next();
    else if (arg === '--cwd') cwd = next();
    else if (arg === '--session') session = next();
    else if (arg === '--count') count = Number(next());
    else if (arg === '--bytes') bytes = Number(next());
    else if (arg === '--tail') tail = next();
    else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }

  if (!conv || !cwd || !session) throw new Error(USAGE);
  return { conv, cwd, session, count, bytes, tail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMessage(index: number, bytes: number, tail: string): string {
  const firstLine = `soak-${index}-${randomUUID()}`;
  const lines = [firstLine];
  let size = firstLine.length;
  while (size < bytes) {
    const filler = 'x'.repeat(FILLER_LINE_CHARS);
    lines.push(filler);
    size += filler.length + 1;
  }
  lines.push(tail);
  return lines.join('\n');
}

async function waitForLanding(cwd: string, session: string, offset: number, message: string): Promise<boolean> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  for (;;) {
    const probe = await probeTranscriptSince(cwd, session, offset, message);
    if (probe.matchedUserRecord) return true;
    if (Date.now() >= deadline) return false;
    await sleep(PROBE_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const { conv, cwd, session, count, bytes, tail } = parseArgs(process.argv.slice(2));
  let landed = 0;

  for (let i = 1; i <= count; i += 1) {
    const message = buildMessage(i, bytes, tail);
    const snap = await captureTranscriptUserRecordSnapshot(cwd, session);
    const offset = snap.readOffset ?? snap.fileSize ?? 0;

    const start = Date.now();
    const result = await deliverAgentMessage(conv, message, 'herdr-submit-soak', undefined, {
      sender: { id: `conv-operator-${process.pid}` },
    });
    const ok = result.ok && await waitForLanding(cwd, session, offset, message);
    const elapsed = Date.now() - start;

    console.log(`#${i} ${ok ? 'landed' : 'NOT LANDED'} in ${elapsed}ms`);
    if (ok) landed += 1;

    await Effect.runPromise(herdrBackend.wait({ agentName: conv }, ['idle', 'done'], AGENT_SETTLE_TIMEOUT_MS));
  }

  console.log(`landed ${landed}/${count}`);
  process.exit(landed === count ? 0 : 1);
}

await main();
