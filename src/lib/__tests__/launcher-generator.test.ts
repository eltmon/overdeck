import { describe, expect, it } from 'vitest';
import { generateLauncherScript, generateLauncherWrapper, type LauncherConfig } from '../launcher-generator.js';

const DEFAULT_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '/workspace/project',
};

describe('generateLauncherScript', () => {
  it('work agent spawn (basic)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6
      "
    `);
  });

  it('work agent with provider and caveman exports', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"\nexport ANTHROPIC_AUTH_TOKEN="tok"',
      cavemanExports: 'export CAVEMAN_DEFAULT_MODE="active"\n',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model gpt-5.4',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
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
      role: 'work',
      spawnMode: 'resume',
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      baseCommand: 'claude --agent pan-work-agent',
      resumeSessionId: 'sess-123',
      model: 'gpt-5.4',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      exec claude --agent pan-work-agent --resume 'sess-123' --model 'gpt-5.4'
      "
    `);
  });

  it('planning agent spawn', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'plan',
      workingDir: '/workspace/project',
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

  it('review role script supports specialist-style prompt launch', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'review',
      workingDir: '/workspace/project',
      setPipefail: true,
      unsetProviderEnv: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
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
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --session-id 'sess-abc' --model 'claude-sonnet-4-6' "$prompt"
      "
    `);
  });

  it('supports prompt files on stdin for headless launchers', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'review',
      promptFile: '/tmp/prompt.md',
      promptFileMode: 'stdin',
      baseCommand: 'claude --print --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
      sessionId: 'sess-abc',
    });

    expect(script).not.toContain('prompt=$(cat');
    expect(script).toContain("exec claude --print --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 --session-id 'sess-abc' < '/tmp/prompt.md'");
  });

  it('review sub-role launcher owns the synthesis signal (PAN-977)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'review',
      promptFile: '/agents/agent-pan-1-review-security/initial-prompt.md',
      promptFileMode: 'stdin',
      trapHup: true,
      baseCommand: 'claude --print --dangerously-skip-permissions --permission-mode bypassPermissions --model gpt-5.5',
      sessionId: 'sess-rev',
      reviewSignal: {
        synthesisAgentId: 'agent-pan-1-review',
        subRole: 'security',
        outputPath: '/agents/agent-pan-1-review-security/review-security.md',
        signalMarkerPath: '/agents/agent-pan-1-review-security/reviewer-signaled',
        launcherPidPath: '/agents/agent-pan-1-review-security/reviewer-launcher.pid',
        timeoutSeconds: 1200,
      },
    });

    // NOT exec — the launcher's bash process must outlive claude so it can
    // signal synthesis deterministically on exit.
    expect(script).not.toContain('exec claude');
    // HUP-immune: the launcher survives the tmux session being reaped.
    expect(script).toContain("trap '' HUP");
    // Writes its own pid for Deacon's liveness check, removes it after signaling.
    expect(script).toContain("echo $$ > '/agents/agent-pan-1-review-security/reviewer-launcher.pid'");
    expect(script).toContain("timeout 1200 claude --print");
    expect(script).toContain("--session-id 'sess-rev' < '/agents/agent-pan-1-review-security/initial-prompt.md'");
    expect(script).toContain('CLAUDE_EXIT=$?');
    expect(script).toContain('if [ "$CLAUDE_EXIT" = "124" ]; then');
    expect(script).toContain('pan tell \'agent-pan-1-review\' "REVIEWER_TIMEOUT security reviewer exceeded 1200s deadline" || true');
    expect(script).toContain('elif [ -s \'/agents/agent-pan-1-review-security/review-security.md\' ]; then');
    expect(script).toContain('pan tell \'agent-pan-1-review\' "REVIEWER_READY security /agents/agent-pan-1-review-security/review-security.md" || true');
    expect(script).toContain('pan tell \'agent-pan-1-review\' "REVIEWER_FAILED security reviewer exited (code $CLAUDE_EXIT) without writing report" || true');
    expect(script).toContain("touch '/agents/agent-pan-1-review-security/reviewer-signaled'");
    expect(script).toContain("rm -f '/agents/agent-pan-1-review-security/reviewer-launcher.pid'");
  });

  it('work role identity prompt launch', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
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
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --session-id 'sess-xyz' --model 'claude-sonnet-4-6' "$prompt"
      "
    `);
  });

  it('review agent', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'review',
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
      role: 'work',
      spawnMode: 'conversation',
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
      role: 'work',
      spawnMode: 'conversation',
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
      role: 'work',
      spawnMode: 'remote',
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
      role: 'work',
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
      role: 'work',
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
      role: 'work',
      spawnMode: 'remote',
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
      role: 'work',
      changeDir: false,
      baseCommand: 'claude --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
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
      role: 'work',
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
      role: 'work',
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
      role: 'plan',
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
      role: 'work',
      spawnMode: 'resume',
      baseCommand: 'claude --agent pan-work-agent',
      resumeSessionId: 'sess-123',
    });
    expect(script).toContain('--agent pan-work-agent');
    expect(script).toContain("--resume 'sess-123'");
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
    expect(script).not.toMatch(/--permission-mode/);
  });

  it('review role with --agent flag', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'review',
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
      role: 'work',
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
      role: 'work',
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

    it('flag-on for review role: same flags applied before session/model', () => {
      const script = generateLauncherScript({
        ...DEFAULT_CONFIG,
        role: 'review',
        baseCommand: 'claude',
        sessionId: 'sess-spec',
        model: 'claude-sonnet-4-6',
        channelsBridgeMcpConfig: '/tmp/agent-y/.mcp.json',
      });
      expect(script).toContain(
        "claude --mcp-config '/tmp/agent-y/.mcp.json' --dangerously-load-development-channels server:panopticon-bridge --session-id 'sess-spec' --model 'claude-sonnet-4-6'",
      );
      expect(script).not.toContain('--strict-mcp-config');
    });
  });
});

describe('generateLauncherScript — Pi harness (PAN-636)', () => {
  it('emits pi --mode rpc with --no-context-files, --extension, and stdin from fifo (AC1, AC2, AC4)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'pi',
      model: 'anthropic/claude-sonnet-4-6',
      piExtensionPath: '/abs/packages/pi-extension/dist/index.js',
      piFifoPath: '/home/u/.panopticon/agents/agent-pan-636/rpc.in',
      piSessionDir: '/home/u/.panopticon/agents/agent-pan-636/sessions',
      // Pi has no permission system — these flags must be DROPPED (AC4).
      permissionFlags: ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
      promptFile: '/tmp/prompt.txt',
    });
    // AC4: no claude permission flags leak into the pi command line.
    expect(script).not.toMatch(/--dangerously-skip-permissions/);
    expect(script).not.toMatch(/--permission-mode/);
    // AC1: rpc + extension + no-context-files all present.
    expect(script).toMatch(/pi --mode rpc/);
    expect(script).toMatch(/--no-context-files/);
    expect(script).toMatch(/--extension '\/abs\/packages\/pi-extension\/dist\/index\.js'/);
    // AC2: stdin redirected from the fifo via bash read-write redirection so
    // opening the FIFO does not block before Pi can write its ready marker.
    expect(script).toMatch(/<> '\/home\/u\/\.panopticon\/agents\/agent-pan-636\/rpc\.in'/);
    // Defensive: read-only redirection would deadlock; assert it is NOT used.
    expect(script).not.toMatch(/[^<]< '\/home\/u\/\.panopticon\/agents\/agent-pan-636\/rpc\.in'/);
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      cd -- '/workspace/project'
      prompt=$(cat '/tmp/prompt.txt')
      exec pi --mode rpc --model 'anthropic/claude-sonnet-4-6' --session-dir '/home/u/.panopticon/agents/agent-pan-636/sessions' --extension '/abs/packages/pi-extension/dist/index.js' --no-context-files --append-system-prompt "$prompt" <> '/home/u/.panopticon/agents/agent-pan-636/rpc.in'
      "
    `);
  });

  it('uses non-deadlocking <> FIFO redirection so Pi can emit ready.json before any writer attaches (PAN-1055 regression)', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'work',
      harness: 'pi',
      model: 'anthropic/claude-sonnet-4-6',
      piExtensionPath: '/abs/ext.js',
      piFifoPath: '/tmp/agent-x/rpc.in',
      piSessionDir: '/tmp/agent-x/sessions',
    });
    // Bash `< fifo` blocks until a writer opens the FIFO. That deadlocked Pi
    // conversation/fork launches because Pi could not exec — and could not
    // write ready.json — until something else opened the FIFO for write.
    // Bash `<> fifo` opens the FIFO read/write and never blocks.
    expect(script).toMatch(/<> '\/tmp\/agent-x\/rpc\.in'/);
    expect(script).not.toMatch(/[^<]< '\/tmp\/agent-x\/rpc\.in'/);
  });

  it('appends --session for resumeSessionId on pi launchers', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
      spawnMode: 'resume',
      harness: 'pi',
      model: 'gpt-5.4-mini',
      piExtensionPath: '/x/dist/index.js',
      piFifoPath: '/x/rpc.in',
      piSessionDir: '/x/sessions',
      resumeSessionId: 'sess-pi-123',
    });
    expect(script).toMatch(/--session 'sess-pi-123'/);
    expect(script).toMatch(/exec pi --mode rpc --model 'gpt-5.4-mini'/);
  });

  it('throws when pi launcher is missing required path config', () => {
    // piSessionDir is the universal requirement (rpc + tui both need it)
    expect(() =>
      generateLauncherScript({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'pi',
        model: 'gpt-5.4-mini',
      }),
    ).toThrow(/piSessionDir/);

    // rpc-mode (default) additionally requires piExtensionPath and piFifoPath.
    expect(() =>
      generateLauncherScript({
        ...DEFAULT_CONFIG,
        agentType: 'work',
        harness: 'pi',
        model: 'gpt-5.4-mini',
        piSessionDir: '/x/sessions',
        // missing piExtensionPath
      }),
    ).toThrow(/piExtensionPath/);

    expect(() =>
      generateLauncherScript({
        ...DEFAULT_CONFIG,
        agentType: 'work',
        harness: 'pi',
        model: 'gpt-5.4-mini',
        piSessionDir: '/x/sessions',
        piExtensionPath: '/x/dist/index.js',
        // missing piFifoPath
      }),
    ).toThrow(/piFifoPath/);
  });

  it('pi tui mode launcher omits --mode rpc and FIFO redirect', () => {
    const script = generateLauncherScript({
      ...DEFAULT_CONFIG,
      agentType: 'conversation',
      harness: 'pi',
      piMode: 'tui',
      model: 'gpt-5.4-mini',
      piSessionDir: '/x/sessions',
      piExtensionPath: '/x/dist/index.js',
    });
    // No --mode rpc flag
    expect(script).not.toMatch(/--mode rpc/);
    // No FIFO redirect (`<>`)
    expect(script).not.toMatch(/<> /);
    // Still has --session-dir and --extension
    expect(script).toMatch(/--session-dir '\/x\/sessions'/);
    expect(script).toMatch(/--extension '\/x\/dist\/index.js'/);
  });

  it('claude-code (default) output is bit-for-bit unchanged when harness is unset (AC3)', () => {
    const a = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    const b = generateLauncherScript({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'claude-code',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(a).toBe(b);
  });
});
