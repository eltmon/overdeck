import { readFile } from 'node:fs/promises';
import { Schema } from 'effect';
import { Command } from 'commander';
import { FlywheelStatus } from '@panctl/contracts';

type InputStream = AsyncIterable<string | Buffer | Uint8Array>;

interface EmitStatusOptions {
  file: string;
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);

function dashboardBaseUrl(): string {
  return (process.env.PANOPTICON_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011').replace(/\/$/, '');
}

export async function readFlywheelStatusJson(file: string, input: InputStream = process.stdin): Promise<string> {
  if (file !== '-') return readFile(file, 'utf8');

  const chunks: string[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  }
  return chunks.join('');
}

export function parseFlywheelStatusJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON: ${message}`);
  }
}

export function validateFlywheelStatusPayload(payload: unknown): FlywheelStatus {
  try {
    return decodeFlywheelStatus(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid FlywheelStatus: ${message}`);
  }
}

export async function postFlywheelStatus(status: FlywheelStatus, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${dashboardBaseUrl()}/api/flywheel/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(status),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dashboard rejected FlywheelStatus (${res.status})${body ? `: ${body}` : ''}`);
  }
}

export async function emitStatusCommand(options: EmitStatusOptions): Promise<void> {
  try {
    const raw = await readFlywheelStatusJson(options.file);
    const payload = parseFlywheelStatusJson(raw);
    const status = validateFlywheelStatusPayload(payload);
    await postFlywheelStatus(status);
    console.log(`Flywheel status emitted for ${status.runId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function registerFlywheelCommands(program: Command): void {
  const flywheel = program
    .command('flywheel')
    .description('Flywheel orchestrator lifecycle and status helpers');

  flywheel
    .command('emit-status')
    .description('Validate and publish a FlywheelStatus JSON snapshot to the local dashboard')
    .requiredOption('--file <path>', 'Path to FlywheelStatus JSON, or - to read from stdin')
    .action(emitStatusCommand);
}
