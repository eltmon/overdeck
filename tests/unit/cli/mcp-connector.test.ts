/**
 * PAN-4950 WI-11: `pan mcp connector` registration. The five subcommands, the `--port` check that
 * runs before any connector module loads, and a lazy load that keeps werift out of CLI startup.
 */
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  werift: vi.fn(() => ({})),
  serve: vi.fn(() => ({ runConnectorServe: vi.fn(async () => 0) })),
  exitCli: vi.fn(async (code: number) => {
    throw new Error(`exit ${code}`);
  }),
}));

vi.mock('werift', () => mocks.werift());
vi.mock('../../../src/lib/mcp/connector/serve.js', () => mocks.serve());
vi.mock('../../../src/cli/exit.js', () => ({ exitCli: mocks.exitCli }));

const { registerMcpCommands } = await import('../../../src/cli/commands/mcp.js');
const { parseConnectorPort, PORT_MESSAGE } = await import('../../../src/cli/commands/mcp-connector.js');

function program(): Command {
  const created = new Command().name('pan').version('9.9.9').exitOverride();
  registerMcpCommands(created);
  return created;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pan mcp connector', () => {
  it('has exactly login, pair, serve, status and logout', () => {
    const mcp = program().commands.find((command) => command.name() === 'mcp');
    const connector = mcp?.commands.find((command) => command.name() === 'connector');
    expect(connector?.commands.map((command) => command.name())).toEqual(['login', 'pair', 'serve', 'status', 'logout']);
  });

  it.each(['0', '70000', '12ab'])('serve --port %s exits 1 before loading the connector', async (port) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(program().parseAsync(['node', 'pan', 'mcp', 'connector', 'serve', '--port', port])).rejects.toThrow('exit 1');
    expect(stderr).toHaveBeenCalledWith(`${PORT_MESSAGE}\n`);
    expect(mocks.serve).not.toHaveBeenCalled();
  });

  it('parses ports', () => {
    expect(parseConnectorPort(undefined)).toBe(7466);
    expect(parseConnectorPort('8080')).toBe(8080);
    expect(parseConnectorPort('65535')).toBe(65535);
    expect(parseConnectorPort('65536')).toBeNull();
    expect(parseConnectorPort('-1')).toBeNull();
  });

  it('does not load werift when the CLI registers the commands', () => {
    program();
    expect(mocks.werift).not.toHaveBeenCalled();
  });
});
