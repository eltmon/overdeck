/** Structural types for the OpenClaw plugin API this plugin uses (PAN-4954 D-1, PAN-4927 W-INT2).
 * OpenClaw's definePluginEntry (openclaw/plugin-sdk/plugin-entry, 2026.10.10) returns exactly this
 * object shape, so the plugin exports it directly and never imports the 274 MB `openclaw` package. */
export interface JsonSchema {
  type: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  default?: unknown; // configSchema only; never in a tool's parameters (WI-4)
}
export interface PluginLogger { info(message: string): void; warn(message: string): void; error(message: string): void; debug?(message: string): void }
export interface ToolResult { content: Array<{ type: 'text'; text: string }> }
export interface PluginTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(toolCallId: string, params: unknown): Promise<ToolResult>;
}
export interface PromptBuildResult { prependContext?: string }
export type PromptBuildHandler = (event: unknown, ctx: unknown) => Promise<PromptBuildResult | undefined>;
export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool(tool: PluginTool): void;
  on(hookName: 'before_prompt_build', handler: PromptBuildHandler): void;
}
export interface OpenClawPluginDefinition {
  id: string;
  name: string;
  description: string;
  configSchema: JsonSchema;
  register(api: OpenClawPluginApi): void;
}
