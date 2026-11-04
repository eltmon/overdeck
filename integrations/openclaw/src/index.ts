/** The Overdeck plugin entry for OpenClaw (PAN-4954 WI-9, FR-2, FR-4, D-1, D-5; PAN-4927 W-INT2).
 * The default export is the plain object OpenClaw's definePluginEntry would build, so the plugin
 * never imports the `openclaw` package. register never returns early: contracts.tools must match
 * the runtime registrations, so a setup problem becomes the tools' answer instead. */
import { checkConnectorUrl, CONFIG_SCHEMA, readConfig } from './config.js';
import { createMcpClient } from './mcp-client.js';
import type { OpenClawPluginDefinition } from './openclaw-api.js';
import { createSummaryHook } from './summary.js';
import { createTools } from './tools.js';

const plugin: OpenClawPluginDefinition = {
  id: 'overdeck',
  name: 'Overdeck',
  description: 'See and steer your Overdeck coding agents from OpenClaw.',
  configSchema: CONFIG_SCHEMA,
  register(api) {
    const config = readConfig(api.pluginConfig);
    const url = checkConnectorUrl(config.connectorUrl);
    const setupError = !url.ok ? url.reason
      : config.localToken === null ? 'localToken is not set (plugins.entries.overdeck.config.localToken)'
      : null;
    const client = setupError === null && url.ok && config.localToken !== null
      ? createMcpClient({ url: url.url, token: config.localToken })
      : null;
    if (setupError) api.logger.warn(`[overdeck] ${setupError}. The Overdeck tools will answer with this error.`);
    for (const tool of createTools({ getConfig: () => readConfig(api.pluginConfig), client, setupError })) api.registerTool(tool);
    if (config.summary && client) api.on('before_prompt_build', createSummaryHook({ client, logger: api.logger }));
  },
};

export default plugin;
