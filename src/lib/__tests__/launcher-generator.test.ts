import { describe, expect, it } from 'vitest';
import { generateLauncherScript, generateLauncherWrapper, type LauncherConfig } from '../launcher-generator.js';

const DEFAULT_CONFIG: LauncherConfig = {
  agentType: 'work',
  workingDir: '/workspace/project',
};

describe('generateLauncherScript', () => {
  it('work agent spawn (basic)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      export CI=1
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6
      "
    `);
  });

  it('work agent with provider and caveman exports', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"\nexport ANTHROPIC_AUTH_TOKEN="tok"',
      cavemanExports: 'export CAVEMAN_DEFAULT_MODE="active"\n',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model gpt-5.4',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      export CI=1
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      export ANTHROPIC_AUTH_TOKEN="tok"
      export CAVEMAN_DEFAULT_MODE="active"
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model gpt-5.4
      "
    `);
  });

  it('work agent resume (PAN-982: permissions via --agent frontmatter)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'resume',
      setCi: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      baseCommand: 'claude --agent pan-work-agent',
      resumeSessionId: 'sess-123',
      model: 'gpt-5.4',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      export CI=1
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      exec claude --agent pan-work-agent --resume 'sess-123' --model gpt-5.4
      "
    `);
  });

  it('planning agent spawn', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'planning',
      workingDir: '/workspace/project',
      setCi: true,
      setTerminalEnv: true,
      panopticonEnv: { agentId: 'plan-abc', issueId: 'PAN-824', sessionType: 'planning' },
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      promptFile: '/tmp/init-prompt.txt',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
      trapHup: true,
      debugLog: '/tmp/pan-launcher-debug.log',
      keepAlive: true,
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      export CI=1
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export TERM=xterm-256color
      export COLORTERM=truecolor
      export LANG=C.UTF-8
      export LC_ALL=C.UTF-8
      export PANOPTICON_AGENT_ID='plan-abc'
      export PANOPTICON_ISSUE_ID='PAN-824'
      export PANOPTICON_SESSION_TYPE='planning'
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      trap '' HUP
      prompt=$(cat '/tmp/init-prompt.txt')
      echo "[launcher] Claude starting at $(date)" >> '/tmp/pan-launcher-debug.log'
      claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 "$prompt"
      CLAUDE_EXIT=$?
      echo "[launcher] Claude exited with code $CLAUDE_EXIT at $(date)" >> '/tmp/pan-launcher-debug.log'
      echo ""
      echo "Planning agent has exited. Session kept alive for review."
      echo "Click 'Done' in the dashboard when ready to hand off to implementation."
      echo "[launcher] Keep-alive loop starting at $(date)" >> '/tmp/pan-launcher-debug.log'
      while true; do sleep 60; done
      "
    `);
  });

  it('specialist dispatch inner script', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'specialist-dispatch',
      workingDir: '/workspace/project',
      setPipefail: true,
      unsetProviderEnv: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      setCi: true,
      panopticonEnv: { agentId: 'spec-123', issueId: 'PAN-824', sessionType: 'correctness-review' },
      cavemanExports: 'export CAVEMAN_DEFAULT_MODE="active"\n',
      promptFile: '/tmp/prompt.md',
      baseCommand: 'claude',
      permissionFlags: ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
      sessionId: 'sess-abc',
      model: 'claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      set -o pipefail
      export CI=1
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export PANOPTICON_AGENT_ID='spec-123'
      export PANOPTICON_ISSUE_ID='PAN-824'
      export PANOPTICON_SESSION_TYPE='correctness-review'
      cd -- '/workspace/project'
      unset ANTHROPIC_API_KEY
      unset ANTHROPIC_BASE_URL
      unset ANTHROPIC_AUTH_TOKEN
      unset OPENAI_API_KEY
      unset GEMINI_API_KEY
      unset API_TIMEOUT_MS
      unset CLAUDE_CODE_API_KEY_HELPER_TTL_MS
      export ANTHROPIC_BASE_URL="http://proxy"
      export CAVEMAN_DEFAULT_MODE="active"
      prompt=$(cat '/tmp/prompt.md')
      claude --session-id 'sess-abc' --model claude-sonnet-4-6 --dangerously-skip-permissions --permission-mode bypassPermissions "$prompt"
      echo ""
      echo "## Specialist completed task"
      "
    `);
  });

  it('specialist init/wake', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'specialist-init',
      workingDir: '/workspace/project',
      unsetProviderEnv: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      promptFile: '/tmp/identity.md',
      baseCommand: 'claude',
      permissionFlags: ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
      sessionId: 'sess-xyz',
      model: 'claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      unset ANTHROPIC_API_KEY
      unset ANTHROPIC_BASE_URL
      unset ANTHROPIC_AUTH_TOKEN
      unset OPENAI_API_KEY
      unset GEMINI_API_KEY
      unset API_TIMEOUT_MS
      unset CLAUDE_CODE_API_KEY_HELPER_TTL_MS
      export ANTHROPIC_BASE_URL="http://proxy"
      prompt=$(cat '/tmp/identity.md')
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --session-id 'sess-xyz' --model claude-sonnet-4-6 "$prompt"
      "
    `);
  });

  it('review agent', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'review',
      workingDir: '/workspace/project',
      setPipefail: true,
      unsetPanopticonEnv: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      set -o pipefail
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      unset PANOPTICON_AGENT_ID PANOPTICON_ISSUE_ID PANOPTICON_SESSION_TYPE
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6
      "
    `);
  });

  it('conversation panel (new session)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'conversation',
      workingDir: '/workspace/project',
      setTerminalEnv: true,
      panopticonEnv: { issueId: 'PAN-824' },
      extraEnvExports: ['export ANTHROPIC_BASE_URL="http://proxy"'],
      trapHup: true,
      baseCommand: 'claude',
      sessionId: 'sess-conv',
      extraArgs: '--effort "high"',
      keepAlive: true,
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export TERM=xterm-256color
      export COLORTERM=truecolor
      export LANG=C.UTF-8
      export LC_ALL=C.UTF-8
      export PANOPTICON_ISSUE_ID='PAN-824'
      export ANTHROPIC_BASE_URL="http://proxy"
      cd -- '/workspace/project'
      trap '' HUP
      claude --session-id 'sess-conv' --effort "high"
      echo ""
      echo "Conversation session ended. Close this panel or click Resume to start a new session."
      while true; do sleep 60; done
      "
    `);
  });

  it('conversation panel (resume)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'conversation',
      workingDir: '/workspace/project',
      setTerminalEnv: true,
      trapHup: true,
      baseCommand: 'claude',
      resumeSessionId: 'sess-resume',
      keepAlive: true,
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export TERM=xterm-256color
      export COLORTERM=truecolor
      export LANG=C.UTF-8
      export LC_ALL=C.UTF-8
      cd -- '/workspace/project'
      trap '' HUP
      claude --resume 'sess-resume'
      echo ""
      echo "Conversation session ended. Close this panel or click Resume to start a new session."
      while true; do sleep 60; done
      "
    `);
  });

  it('remote agent', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'remote',
      workingDir: '/workspace/project',
      setRemotePath: true,
      promptFile: '/workspace/.pan/prompts/agent.md',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
      changeDir: false,
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export PATH="/usr/local/bin:$PATH"
      prompt=$(cat '/workspace/.pan/prompts/agent.md')
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 "$prompt"
      "
    `);
  });

  it('runtime adapter', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'runtime',
      workingDir: '/workspace/project',
      promptFile: '/tmp/init-prompt.txt',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      prompt=$(cat '/tmp/init-prompt.txt')
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions "$prompt"
      "
    `);
  });

  it('planning continuation', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      workingDir: '/workspace/project',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
      promptInline: 'Please read the continuation prompt and continue.',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 'Please read the continuation prompt and continue.'
      "
    `);
  });

  it('escapeForBase64 escapes $ characters', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'remote',
      workingDir: '/workspace/project',
      setRemotePath: true,
      promptFile: '/workspace/.pan/prompts/agent.md',
      baseCommand: 'claude --model claude-sonnet-4-6',
      changeDir: false,
      escapeForBase64: true,
    });
    expect(script).toMatch(/\\\$PATH/);
    expect(script).toMatch(/\\\$\(cat/);
    expect(script).toMatch(/"\\\$prompt"/);
    expect(script).not.toMatch(/[^\\]\$PATH/);
    expect(script).not.toMatch(/[^\\]\$\(cat/);
    expect(script).not.toMatch(/[^\\]\$prompt"/);
  });

  it('work agent without changeDir', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      changeDir: false,
      baseCommand: 'claude --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      export CI=1
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      exec claude --model claude-sonnet-4-6
      "
    `);
  });

  // --- PAN-982: --agent flag surfaces in generated launcher scripts ---
  // When getAgentRuntimeBaseCommand() emits `claude --agent pan-<type>-agent`,
  // the generator must pass it through verbatim into the exec line.

  it('work agent with --agent flag (Anthropic model — no --model, no permission flags)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      baseCommand: 'claude --agent pan-work-agent',
    });
    expect(script).toContain('exec claude --agent pan-work-agent');
    expect(script).not.toMatch(/--model/);
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
    expect(script).not.toMatch(/--permission-mode/);
  });

  it('work agent with --agent flag and --model override (non-Anthropic)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      baseCommand: 'claude --agent pan-work-agent --model gpt-5.4',
    });
    expect(script).toContain('--agent pan-work-agent');
    expect(script).toContain('--model gpt-5.4');
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
  });

  it('planning agent with --agent flag', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'planning',
      setCi: true,
      promptFile: '/tmp/init-prompt.txt',
      baseCommand: 'claude --agent pan-planning-agent',
      keepAlive: true,
    });
    expect(script).toContain('claude --agent pan-planning-agent');
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
  });

  it('resume agent preserves --agent across --resume', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'resume',
      setCi: true,
      baseCommand: 'claude --agent pan-work-agent',
      resumeSessionId: 'sess-123',
    });
    expect(script).toContain('--agent pan-work-agent');
    expect(script).toContain("--resume 'sess-123'");
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
    expect(script).not.toMatch(/--permission-mode/);
  });

  it('specialist-dispatch with --agent (review)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'specialist-dispatch',
      promptFile: '/tmp/prompt.md',
      baseCommand: 'claude --agent pan-review-agent',
      sessionId: 'sess-abc',
    });
    expect(script).toContain('--agent pan-review-agent');
    expect(script).toContain("--session-id 'sess-abc'");
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
  });

  it('--agent with --name produces both flags', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      baseCommand: 'claude --agent pan-work-agent --name agent-pan-982',
    });
    expect(script).toContain('--agent pan-work-agent');
    expect(script).toContain('--name agent-pan-982');
  });
});

describe('generateLauncherWrapper', () => {
  it('returns null when not using script wrapper', () => {
    const wrapper = generateLauncherWrapper({
      ...DEFAULT_CONFIG,
      useScriptWrapper: false,
    });
    expect(wrapper).toBeNull();
  });

  it('returns null when scriptLogFile is missing', () => {
    const wrapper = generateLauncherWrapper({
      ...DEFAULT_CONFIG,
      useScriptWrapper: true,
    });
    expect(wrapper).toBeNull();
  });

  it('generates script wrapper with innerScriptPath', () => {
    const wrapper = generateLauncherWrapper({
      ...DEFAULT_CONFIG,
      useScriptWrapper: true,
      scriptLogFile: '/tmp/log.txt',
      innerScriptPath: '/tmp/run-claude.sh',
    });
    expect(wrapper).toMatchInlineSnapshot(`
      "#!/bin/bash
      exec script -qfaec "bash '/tmp/run-claude.sh'" '/tmp/log.txt'
      "
    `);
  });

  it('falls back to workingDir-based inner script path', () => {
    const wrapper = generateLauncherWrapper({
      ...DEFAULT_CONFIG,
      useScriptWrapper: true,
      scriptLogFile: '/tmp/log.txt',
    });
    expect(wrapper).toMatchInlineSnapshot(`
      "#!/bin/bash
      exec script -qfaec "bash '/workspace/project/run-claude.sh'" '/tmp/log.txt'
      "
    `);
  });

  describe('channels bridge args', () => {
    const FIXTURE_CONFIG: LauncherConfig = {
      ...DEFAULT_CONFIG,
      agentType: 'work',
      setCi: true,
      baseCommand:
        'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
      sessionId: 'sess-abc',
    };

    it('flag-off: output is byte-identical to pre-PAN-985 behaviour', () => {
      const script = generateLauncherScript(FIXTURE_CONFIG);
      expect(script).toBe(
        [
          '#!/bin/bash',
          'unset TMUX TMUX_PANE STY',
          'export CI=1',
          'command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"',
          "cd -- '/workspace/project'",
          "exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 --session-id 'sess-abc'",
          '',
        ].join('\n'),
      );
    });

    it('flag-on: appends --mcp-config and --dangerously-load-development-channels before --session-id', () => {
      const script = generateLauncherScript({
        ...FIXTURE_CONFIG,
        channelsBridgeMcpConfig: '/tmp/agent-x/.mcp.json',
      });
      expect(script).toContain(
        "--mcp-config '/tmp/agent-x/.mcp.json' --dangerously-load-development-channels server:panopticon-bridge --session-id 'sess-abc'",
      );
      // Must NOT enable strict-mcp-config (project MCP servers must keep loading)
      expect(script).not.toContain('--strict-mcp-config');
    });

    it('flag-on with custom server name: uses the override', () => {
      const script = generateLauncherScript({
        ...FIXTURE_CONFIG,
        channelsBridgeMcpConfig: '/tmp/x/.mcp.json',
        channelsBridgeServerName: 'custom-bridge',
      });
      expect(script).toContain('server:custom-bridge');
      expect(script).not.toContain('server:panopticon-bridge');
    });

    it('flag-on for specialist-dispatch: same flags applied before session/model', () => {
      const script = generateLauncherScript({
        ...DEFAULT_CONFIG,
        agentType: 'specialist-dispatch',
        baseCommand: 'claude',
        sessionId: 'sess-spec',
        model: 'claude-sonnet-4-6',
        channelsBridgeMcpConfig: '/tmp/agent-y/.mcp.json',
      });
      expect(script).toContain(
        "claude --mcp-config '/tmp/agent-y/.mcp.json' --dangerously-load-development-channels server:panopticon-bridge --session-id 'sess-spec' --model claude-sonnet-4-6",
      );
      expect(script).not.toContain('--strict-mcp-config');
    });
  });
});
