/**
 * PAN-4927 W-INJ4 (PAN-4935): the tools block text is bounded, every tool
 * name it mentions is real, and the CLI block never leaks an MCP tool name.
 */
import { describe, expect, it } from 'vitest';

import {
  INSTRUCTION_TOOL_NAMES,
  OVERDECK_CLI_INSTRUCTIONS,
  OVERDECK_MCP_INSTRUCTIONS,
  overdeckInstructionsBlock,
} from '../../../../src/lib/mcp/agent-instructions.js';
import { ALL_TOOLS } from '../../../../src/lib/mcp/server.js';

const CLI_COMMANDS = [
  'pan worker run',
  'pan worker wait',
  'pan worker report',
  'pan task claim',
  'pan task done',
  'pan done',
  'pan handoff',
  'pan memory add',
  'pan memory search',
  'pan lane start',
  'pan lane wait',
  'pan conversations link-pr',
];

describe('agent-instructions (PAN-4935 W-1)', () => {
  it('each block is at most 1,500 characters', () => {
    expect(OVERDECK_MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(1500);
    expect(OVERDECK_CLI_INSTRUCTIONS.length).toBeLessThanOrEqual(1500);
  });

  it('every INSTRUCTION_TOOL_NAMES entry is a real ALL_TOOLS name and appears backticked in the MCP block', () => {
    const allToolNames = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of INSTRUCTION_TOOL_NAMES) {
      expect(allToolNames.has(name), name).toBe(true);
      expect(OVERDECK_MCP_INSTRUCTIONS, name).toContain(`\`${name}\``);
    }
  });

  it('no backticked underscore token in the MCP block is missing from INSTRUCTION_TOOL_NAMES', () => {
    const backtickedTokens = [...OVERDECK_MCP_INSTRUCTIONS.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const underscoreTokens = backtickedTokens.filter((token) => /^[a-z]+(?:_[a-z]+)+$/.test(token));
    const allowed = new Set(INSTRUCTION_TOOL_NAMES);
    for (const token of underscoreTokens) expect(allowed.has(token), token).toBe(true);
  });

  it('the CLI block names every pan command and no backticked ALL_TOOLS name with an underscore', () => {
    for (const command of CLI_COMMANDS) expect(OVERDECK_CLI_INSTRUCTIONS, command).toContain(command);
    const backtickedTokens = [...OVERDECK_CLI_INSTRUCTIONS.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const underscoreToolNames = new Set(ALL_TOOLS.map((tool) => tool.name).filter((name) => name.includes('_')));
    for (const token of backtickedTokens) expect(underscoreToolNames.has(token), token).toBe(false);
  });

  it('overdeckInstructionsBlock picks the block by the overdeckMcp flag', () => {
    expect(overdeckInstructionsBlock(true)).toBe(OVERDECK_MCP_INSTRUCTIONS);
    expect(overdeckInstructionsBlock(false)).toBe(OVERDECK_CLI_INSTRUCTIONS);
  });
});
