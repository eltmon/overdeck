/**
 * PAN-4927 W-INT4: a runnable example that asks the xAI Responses API to call
 * Overdeck's public MCP server through a remote MCP tool.
 *
 * Required environment variables:
 *   XAI_API_KEY        your xAI API key
 *   OVERDECK_MCP_TOKEN  the access token from `pan mcp oauth issue --name xai-api --level read`
 *   OVERDECK_MCP_URL    your published public MCP URL, https://<machine>.<tailnet>.ts.net:8443/mcp
 *
 * Optional:
 *   XAI_MODEL     defaults to grok-4.7
 *   XAI_BASE_URL  defaults to https://api.x.ai/v1
 *
 * Run (Node 22.16+):
 *   node --experimental-strip-types integrations/grok-bot/examples/xai-api.ts "List my Overdeck conversations."
 *
 * See integrations/grok-bot/README.md.
 */

const ALLOWED_TOOLS = ['list_conversations', 'read_conversation', 'list_pending_input'];
const DEFAULT_MODEL = 'grok-4.7';
const SERVER_LABEL = 'overdeck';

function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret) continue;
    result = result.split(secret).join('[redacted]');
  }
  return result;
}

async function main(): Promise<number> {
  const xaiApiKey = process.env.XAI_API_KEY;
  const overdeckMcpToken = process.env.OVERDECK_MCP_TOKEN;
  const overdeckMcpUrl = process.env.OVERDECK_MCP_URL;
  const secrets = [xaiApiKey, overdeckMcpToken].filter((value): value is string => Boolean(value));

  if (!xaiApiKey || !overdeckMcpToken || !overdeckMcpUrl) {
    console.error('Set XAI_API_KEY, OVERDECK_MCP_TOKEN and OVERDECK_MCP_URL. See integrations/grok-bot/README.md.');
    return 2;
  }

  if (!overdeckMcpUrl.startsWith('https://')) {
    console.error('OVERDECK_MCP_URL must be an https: URL, such as https://YOUR-MACHINE.YOUR-TAILNET.ts.net:8443/mcp');
    return 2;
  }

  const model = process.env.XAI_MODEL || DEFAULT_MODEL;
  const baseUrl = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
  const prompt = process.argv[2] || 'List my Overdeck conversations.';

  const body = {
    model,
    input: prompt,
    tools: [{
      type: 'mcp',
      server_url: overdeckMcpUrl,
      server_label: SERVER_LABEL,
      authorization: overdeckMcpToken,
      allowed_tools: ALLOWED_TOOLS,
    }],
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${xaiApiKey}`,
        'User-Agent': 'overdeck-grok-bot-example/0.1.0',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redact(`Could not reach the xAI API: ${message}`, secrets));
    return 1;
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(redact(`xAI API answered ${response.status}: ${text.slice(0, 2000)}`, secrets));
    return 1;
  }

  const responseText = await response.text();
  let responseBody: any;
  try {
    responseBody = JSON.parse(responseText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redact(`xAI API answered ${response.status} with invalid JSON: ${message}`, secrets));
    return 1;
  }

  const texts: string[] = [];
  for (const item of responseBody?.output ?? []) {
    for (const entry of item?.content ?? []) {
      if (entry?.type === 'output_text' && typeof entry.text === 'string') {
        texts.push(entry.text);
      }
    }
  }

  if (texts.length > 0) {
    console.log(redact(texts.join('\n'), secrets));
  } else {
    console.log(redact(JSON.stringify(responseBody, null, 2), secrets));
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
