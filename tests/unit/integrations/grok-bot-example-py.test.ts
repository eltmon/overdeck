import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { XAI_ALLOWED_TOOLS, XAI_DEFAULT_MODEL, XAI_SERVER_LABEL } from '../../../src/dashboard/frontend/src/components/Settings/anywhere/botSnippets';

// PAN-4956 W-INT4 WI-4 (AC-4): the Python xAI Responses API example against a local fake server.
const execFileAsync = promisify(execFile);
const EXAMPLE = new URL('../../../integrations/grok-bot/examples/xai-api.py', import.meta.url).pathname;
const OVERDECK_MCP_TOKEN = 'odk_' + 'f'.repeat(64);
const OVERDECK_MCP_URL = 'https://box.tail1.ts.net:8443/mcp';

type RecordedRequest = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: unknown };

let server: ReturnType<typeof createServer>;
let port: number;
let requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      });
      const { status, body } = nextResponse;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a port');
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  requests = [];
  nextResponse = { status: 200, body: {} };
});

function run(args: string[], env: Record<string, string>) {
  return execFileAsync(
    'python3',
    [EXAMPLE, ...args],
    { env: { PATH: process.env.PATH ?? '', PYTHONDONTWRITEBYTECODE: '1', ...env }, timeout: 20_000 },
  );
}

const baseEnv = () => ({
  XAI_API_KEY: 'xai-test-key',
  OVERDECK_MCP_TOKEN,
  OVERDECK_MCP_URL,
  XAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
});

describe('integrations/grok-bot examples/xai-api.py', () => {
  it('sends the expected request and prints the output text on 2xx', async () => {
    nextResponse = {
      status: 200,
      body: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'You have 3 conversations.' }] }] },
    };

    const { stdout, stderr } = await run(['List my Overdeck conversations.'], baseEnv());

    expect(stdout).toContain('You have 3 conversations.');
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/responses');
    expect(request.headers.authorization).toBe('Bearer xai-test-key');
    const body = request.body as { model: string; tools: unknown[] };
    expect(body.model).toBe(XAI_DEFAULT_MODEL);
    expect(body.tools).toEqual([{
      type: 'mcp',
      server_url: OVERDECK_MCP_URL,
      server_label: XAI_SERVER_LABEL,
      authorization: OVERDECK_MCP_TOKEN,
      allowed_tools: [...XAI_ALLOWED_TOOLS],
    }]);
    expect(stdout).not.toContain('xai-test-key');
    expect(stdout).not.toContain(OVERDECK_MCP_TOKEN);
    expect(stderr).not.toContain('xai-test-key');
    expect(stderr).not.toContain(OVERDECK_MCP_TOKEN);
  });

  it('redacts secrets and exits 1 on a non-2xx answer', async () => {
    nextResponse = { status: 401, body: `unauthorized: token=${OVERDECK_MCP_TOKEN} key=xai-test-key` };

    const error = (await run(['List my Overdeck conversations.'], baseEnv()).catch((e) => e)) as {
      code: number;
      stdout: string;
      stderr: string;
    };

    expect(error.code).toBe(1);
    expect(error.stderr).toContain('xAI API answered 401');
    expect(error.stderr).toContain('[redacted]');
    expect(error.stderr).not.toContain(OVERDECK_MCP_TOKEN);
    expect(error.stderr).not.toContain('xai-test-key');
  });

  it('exits 1 with a clear message on invalid JSON in a 2xx answer', async () => {
    nextResponse = { status: 200, body: 'not valid json {' };

    const error = (await run(['List my Overdeck conversations.'], baseEnv()).catch((e) => e)) as {
      code: number;
      stderr: string;
    };

    expect(error.code).toBe(1);
    expect(error.stderr).toContain('xAI API answered 200 with invalid JSON');
  });

  it('exits 2 with no request when OVERDECK_MCP_TOKEN is unset', async () => {
    const env = baseEnv();
    delete (env as Record<string, string | undefined>).OVERDECK_MCP_TOKEN;

    await expect(run(['List my Overdeck conversations.'], env as Record<string, string>)).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('Set XAI_API_KEY, OVERDECK_MCP_TOKEN and OVERDECK_MCP_URL'),
    });
    expect(requests).toHaveLength(0);
  });

  it('exits 2 with no request when OVERDECK_MCP_URL is not https:', async () => {
    const env = { ...baseEnv(), OVERDECK_MCP_URL: 'http://box.tail1.ts.net:8443/mcp' };

    await expect(run(['List my Overdeck conversations.'], env)).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('must be an https: URL'),
    });
    expect(requests).toHaveLength(0);
  });
});
