import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateLauncherScriptSync, generateLauncherWrapperSync, type LauncherConfig } from '../launcher-generator.js';

// Pin OVERDECK_HOME to an empty temp dir so the COLORFGBG export (derived
// from ~/.overdeck/ui-theme.json) deterministically uses the dark default
// regardless of the developer machine's synced dashboard theme.
let tempHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-launcher-test-'));
  prevHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const DEFAULT_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '/workspace/project',
};

describe('generateLauncherScript', () => {
  it('work agent spawn (basic)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6
      "
    `);
  });

  it('work agent with provider and caveman exports', () => {
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      export ANTHROPIC_AUTH_TOKEN="tok"
      export CAVEMAN_DEFAULT_MODE="active"
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model gpt-5.4
      "
    `);
  });

  it('work agent resume (PAN-982: permissions via --agent frontmatter)', () => {
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      exec claude --agent pan-work-agent --resume 'sess-123' --model 'gpt-5.4'
      "
    `);
  });

  it('planning agent spawn', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'plan',
      workingDir: '/workspace/project',
      setTerminalEnv: true,
      overdeckEnv: { agentId: 'plan-abc', issueId: 'PAN-824', sessionType: 'planning' },
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
      export SKIP_DOCS_INDEX=1
      export TERM=xterm-256color
      export COLORTERM=truecolor
      export LANG=C.UTF-8
      export LC_ALL=C.UTF-8
      export COLORFGBG='15;0'
      export OVERDECK_AGENT_ID='plan-abc'
      export OVERDECK_ISSUE_ID='PAN-824'
      export OVERDECK_SESSION_TYPE='planning'
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
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'review',
      workingDir: '/workspace/project',
      setPipefail: true,
      unsetProviderEnv: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      overdeckEnv: { agentId: 'spec-123', issueId: 'PAN-824', sessionType: 'correctness-review' },
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
      export SKIP_DOCS_INDEX=1
      export OVERDECK_AGENT_ID='spec-123'
      export OVERDECK_ISSUE_ID='PAN-824'
      export OVERDECK_SESSION_TYPE='correctness-review'
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
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
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
        timeoutSeconds: 1800,
      },
    });

    // NOT exec — the launcher's bash process must outlive claude so it can
    // signal synthesis deterministically on exit.
    expect(script).not.toContain('exec claude');
    // HUP-immune: the launcher survives the tmux session being reaped.
    expect(script).toContain("trap '' HUP");
    // Writes its own pid for Deacon's liveness check, removes it after signaling.
    expect(script).toContain("echo $$ > '/agents/agent-pan-1-review-security/reviewer-launcher.pid'");
    expect(script).toContain("timeout 1800 claude --print");
    expect(script).toContain("--session-id 'sess-rev' < '/agents/agent-pan-1-review-security/initial-prompt.md'");
    expect(script).toContain('CLAUDE_EXIT=$?');
    expect(script).toContain('if [ "$CLAUDE_EXIT" = "124" ]; then');
    expect(script).toContain('pan tell \'agent-pan-1-review\' "REVIEWER_TIMEOUT security reviewer exceeded 1800s deadline" || true');
    expect(script).toContain('elif [ -s \'/agents/agent-pan-1-review-security/review-security.md\' ]; then');
    expect(script).toContain('pan tell \'agent-pan-1-review\' "REVIEWER_READY security /agents/agent-pan-1-review-security/review-security.md" || true');
    expect(script).toContain('pan tell \'agent-pan-1-review\' "REVIEWER_FAILED security reviewer exited (code $CLAUDE_EXIT) without writing report" || true');
    expect(script).toContain("touch '/agents/agent-pan-1-review-security/reviewer-signaled'");
    expect(script).toContain("rm -f '/agents/agent-pan-1-review-security/reviewer-launcher.pid'");
  });

  it('work role identity prompt launch', () => {
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
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
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'review',
      workingDir: '/workspace/project',
      setPipefail: true,
      unsetOverdeckEnv: true,
      providerExports: 'export ANTHROPIC_BASE_URL="http://proxy"',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      set -o pipefail
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      unset OVERDECK_AGENT_ID OVERDECK_ISSUE_ID OVERDECK_SESSION_TYPE
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6
      "
    `);
  });

  it('conversation panel (new session)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      spawnMode: 'conversation',
      workingDir: '/workspace/project',
      setTerminalEnv: true,
      overdeckEnv: { issueId: 'PAN-824' },
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
      export SKIP_DOCS_INDEX=1
      export TERM=xterm-256color
      export COLORTERM=truecolor
      export LANG=C.UTF-8
      export LC_ALL=C.UTF-8
      export COLORFGBG='15;0'
      export OVERDECK_ISSUE_ID='PAN-824'
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
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
      export TERM=xterm-256color
      export COLORTERM=truecolor
      export LANG=C.UTF-8
      export LC_ALL=C.UTF-8
      export COLORFGBG='15;0'
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
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
      export PATH="/usr/local/bin:$PATH"
      prompt=$(cat '/workspace/.pan/prompts/agent.md')
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 "$prompt"
      "
    `);
  });

  it('runtime adapter', () => {
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      prompt=$(cat '/tmp/init-prompt.txt')
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions "$prompt"
      "
    `);
  });

  it('planning continuation', () => {
    const script = generateLauncherScriptSync({
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
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 'Please read the continuation prompt and continue.'
      "
    `);
  });

  it('escapeForBase64 escapes $ characters', () => {
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      changeDir: false,
      baseCommand: 'claude --model claude-sonnet-4-6',
    });
    expect(script).toMatchInlineSnapshot(`
      "#!/bin/bash
      unset TMUX TMUX_PANE STY
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export SKIP_DOCS_INDEX=1
      exec claude --model claude-sonnet-4-6
      "
    `);
  });

  // --- PAN-982: --agent flag surfaces in generated launcher scripts ---
  // When getAgentRuntimeBaseCommand() emits `claude --agent pan-<type>-agent`,
  // the generator must pass it through verbatim into the exec line.

  it('appends workspace and briefing system prompt files without adding model flags', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --agent pan-work-agent',
      appendSystemPromptFiles: [
        '/workspace/project/.pan/context/workspace.md',
        '/home/u/.overdeck/session-context.md',
      ],
    });

    expect(script).toContain("--append-system-prompt-file '/workspace/project/.pan/context/workspace.md' --append-system-prompt-file '/home/u/.overdeck/session-context.md'");
    expect(script).not.toMatch(/--model/);
  });

  it('work agent with --agent flag (Anthropic model — no --model, no permission flags)', () => {
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
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
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --agent pan-work-agent --name agent-pan-982',
    });
    expect(script).toContain('--agent pan-work-agent');
    expect(script).toContain('--name agent-pan-982');
  });

  it('wraps work agent claude command in the PTY supervisor', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --agent pan-work-agent',
      sessionId: 'sess-supervisor',
      model: 'gpt-5.5',
      useSupervisor: true,
      supervisorScriptPath: '/opt/pan dist/pty-supervisor.js',
    });
    const execLines = script.split('\n').filter((line) => line.startsWith('exec '));
    expect(execLines).toEqual([
      "exec node '/opt/pan dist/pty-supervisor.js' claude --agent pan-work-agent --session-id 'sess-supervisor' --model 'gpt-5.5'",
    ]);
  });

  it('wraps conversation claude command while preserving post-exit behavior', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      spawnMode: 'conversation',
      workingDir: '/workspace/project',
      setTerminalEnv: true,
      trapHup: true,
      baseCommand: 'claude',
      sessionId: 'sess-conv',
      extraArgs: '--effort "high"',
      keepAlive: true,
      useSupervisor: true,
      supervisorScriptPath: '/opt/pty-supervisor.js',
    });
    expect(script).toContain("node '/opt/pty-supervisor.js' claude --session-id 'sess-conv' --effort \"high\"");
    expect(script).toContain('echo "Conversation session ended. Close this panel or click Resume to start a new session."');
    expect(script).toContain('while true; do sleep 60; done');
    expect(script).not.toContain('exec node');
  });

  it('leaves work and conversation launchers byte-identical when supervisor is disabled', () => {
    const workConfig: LauncherConfig = {
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --agent pan-work-agent',
      sessionId: 'sess-work',
    };
    expect(generateLauncherScriptSync({ ...workConfig, useSupervisor: false })).toBe(
      generateLauncherScriptSync(workConfig),
    );

    const conversationConfig: LauncherConfig = {
      ...DEFAULT_CONFIG,
      role: 'work',
      spawnMode: 'conversation',
      baseCommand: 'claude',
      resumeSessionId: 'sess-conv',
      keepAlive: true,
    };
    expect(generateLauncherScriptSync({ ...conversationConfig, useSupervisor: false })).toBe(
      generateLauncherScriptSync(conversationConfig),
    );
  });

  it('requires supervisorScriptPath when supervisor wrapping is enabled', () => {
    expect(() =>
      generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        baseCommand: 'claude',
        useSupervisor: true,
      }),
    ).toThrow(/supervisorScriptPath/);
  });

  it('quotes supervisorScriptPath in the emitted exec line', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude',
      useSupervisor: true,
      supervisorScriptPath: "/tmp/pan's supervisor.js",
    });
    expect(script).toContain("exec node '/tmp/pan'\\''s supervisor.js' claude");
  });

  it('ignores supervisor wrapping for ohmypi launchers and review sub-role launchers', () => {
    const piScript = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'ohmypi',
      piExtensionPath: '/x/dist/index.js',
      piFifoPath: '/x/rpc.in',
      piSessionDir: '/x/sessions',
      useSupervisor: true,
      supervisorScriptPath: '/opt/pty-supervisor.js',
    });
    // PAN-2108: rpc path runs omp without `exec` so the launcher bash survives
    // to record omp's exit; the supervisor is still skipped for ohmypi.
    expect(piScript).toContain('omp --mode rpc');
    expect(piScript).not.toContain('exec omp');
    expect(piScript).not.toContain('pty-supervisor.js');

    const reviewScript = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'review',
      promptFile: '/tmp/prompt.md',
      promptFileMode: 'stdin',
      baseCommand: 'claude --print',
      sessionId: 'sess-review',
      useSupervisor: true,
      supervisorScriptPath: '/opt/pty-supervisor.js',
      reviewSignal: {
        synthesisAgentId: 'agent-pan-1-review',
        subRole: 'security',
        outputPath: '/tmp/review.md',
        signalMarkerPath: '/tmp/reviewer-signaled',
        launcherPidPath: '/tmp/reviewer-launcher.pid',
        timeoutSeconds: 1800,
      },
    });
    expect(reviewScript).toContain('timeout 1800 claude --print');
    expect(reviewScript).not.toContain('pty-supervisor.js');
  });
});

describe('generateLauncherWrapper', () => {
  it('returns null when not using script wrapper', () => {
    const wrapper = generateLauncherWrapperSync({
      ...DEFAULT_CONFIG,
      useScriptWrapper: false,
    });
    expect(wrapper).toBeNull();
  });

  it('returns null when scriptLogFile is missing', () => {
    const wrapper = generateLauncherWrapperSync({
      ...DEFAULT_CONFIG,
      useScriptWrapper: true,
    });
    expect(wrapper).toBeNull();
  });

  it('generates script wrapper with innerScriptPath', () => {
    const wrapper = generateLauncherWrapperSync({
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
    const wrapper = generateLauncherWrapperSync({
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
      const script = generateLauncherScriptSync(FIXTURE_CONFIG);
      expect(script).toBe(
        [
          '#!/bin/bash',
          'unset TMUX TMUX_PANE STY',
          'command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"',
          'export SKIP_DOCS_INDEX=1',
          "cd -- '/workspace/project'",
          "exec claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6 --session-id 'sess-abc'",
          '',
        ].join('\n'),
      );
    });

    it('flag-on: appends --mcp-config and --dangerously-load-development-channels before --session-id', () => {
      const script = generateLauncherScriptSync({
        ...FIXTURE_CONFIG,
        channelsBridgeMcpConfig: '/tmp/agent-x/.mcp.json',
      });
      expect(script).toContain(
        "--mcp-config '/tmp/agent-x/.mcp.json' --dangerously-load-development-channels server:overdeck-bridge --session-id 'sess-abc'",
      );
      // Must NOT enable strict-mcp-config (project MCP servers must keep loading)
      expect(script).not.toContain('--strict-mcp-config');
    });

    it('flag-on with custom server name: uses the override', () => {
      const script = generateLauncherScriptSync({
        ...FIXTURE_CONFIG,
        channelsBridgeMcpConfig: '/tmp/x/.mcp.json',
        channelsBridgeServerName: 'custom-bridge',
      });
      expect(script).toContain('server:custom-bridge');
      expect(script).not.toContain('server:overdeck-bridge');
    });

    it('flag-on for review role: same flags applied before session/model', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'review',
        baseCommand: 'claude',
        sessionId: 'sess-spec',
        model: 'claude-sonnet-4-6',
        channelsBridgeMcpConfig: '/tmp/agent-y/.mcp.json',
      });
      expect(script).toContain(
        "claude --mcp-config '/tmp/agent-y/.mcp.json' --dangerously-load-development-channels server:overdeck-bridge --session-id 'sess-spec' --model 'claude-sonnet-4-6'",
      );
      expect(script).not.toContain('--strict-mcp-config');
    });
  });
});

describe('generateLauncherScript — ohmypi harness (PAN-1989)', () => {
  // ─── ohmypi harness tests ──────────────────────────────────────────────────

  it('ohmypi: emits omp --mode rpc with --extension, no --no-context-files, and stdin from fifo (AC1)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'ohmypi',
      model: 'anthropic/claude-sonnet-4-6',
      piExtensionPath: '/abs/packages/ohmypi-extension/dist/index.js',
      piFifoPath: '/home/u/.overdeck/agents/agent-pan-1989/rpc.in',
      piSessionDir: '/home/u/.overdeck/agents/agent-pan-1989/sessions',
      promptFile: '/tmp/prompt.txt',
    });
    // Binary is omp, not pi. PAN-2108: the rpc path no longer uses `exec` so the
    // launcher bash outlives omp and can record its exit (silent-death trace).
    expect(script).toMatch(/\bomp --mode rpc/);
    expect(script).not.toMatch(/exec omp/);
    expect(script).not.toMatch(/exec pi --mode/);
    // --no-context-files REMOVED in omp (docs/ohmypi-contract.md).
    expect(script).not.toMatch(/--no-context-files/);
    // Extension and session-dir still present.
    expect(script).toMatch(/--extension '\/abs\/packages\/ohmypi-extension\/dist\/index.js'/);
    expect(script).toMatch(/--session-dir '\/home\/u\/\.overdeck\/agents\/agent-pan-1989\/sessions'/);
    // FIFO redirection is `<>` (non-blocking), same as pi.
    expect(script).toMatch(/<> '\/home\/u\/\.overdeck\/agents\/agent-pan-1989\/rpc\.in'/);
    expect(script).toMatch(/>> '\/home\/u\/\.overdeck\/agents\/agent-pan-1989\/output\.log' 2>&1/);
    // PAN-2108: omp's exit code + timestamp recorded to exit-status on death, and
    // the launcher exits with omp's code so `#{pane_exit_status}` reflects it too.
    expect(script).toMatch(/__omp_exit=\$\?/);
    expect(script).toMatch(/> '\/home\/u\/\.overdeck\/agents\/agent-pan-1989\/exit-status'/);
    expect(script).toMatch(/exit \$__omp_exit/);
  });

  it('ohmypi: uses --resume (not --session) for resumeSessionId (AC1, contract)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      spawnMode: 'resume',
      harness: 'ohmypi',
      model: 'gpt-5.4-mini',
      piExtensionPath: '/x/dist/index.js',
      piFifoPath: '/x/rpc.in',
      piSessionDir: '/x/sessions',
      resumeSessionId: 'sess-omp-456',
    });
    expect(script).toMatch(/--resume 'sess-omp-456'/);
    expect(script).not.toMatch(/--session 'sess-omp-456'/);
  });

  it('ohmypi: wrapWithSupervisor skips supervisor wrapping for ohmypi harness (AC3)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'ohmypi',
      piExtensionPath: '/x/dist/index.js',
      piFifoPath: '/x/rpc.in',
      piSessionDir: '/x/sessions',
      useSupervisor: true,
      supervisorScriptPath: '/opt/pty-supervisor.js',
    });
    expect(script).toMatch(/\bomp --mode rpc/);
    expect(script).not.toMatch(/exec omp/);
    expect(script).not.toContain('pty-supervisor.js');
  });

  it('ohmypi: tui mode omits --mode rpc and FIFO redirect (AC2)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      agentType: 'conversation',
      harness: 'ohmypi',
      piMode: 'tui',
      model: 'gpt-5.4-mini',
      piSessionDir: '/x/sessions',
      piExtensionPath: '/x/dist/index.js',
    });
    expect(script).not.toMatch(/--mode rpc/);
    expect(script).not.toMatch(/<> /);
    expect(script).toMatch(/--session-dir '\/x\/sessions'/);
    expect(script).toMatch(/--extension '\/x\/dist\/index.js'/);
    expect(script).not.toMatch(/--no-context-files/);
    expect(script).toMatch(/\bomp\b/);
  });

  // ─── Codex harness tests (PAN-1574) ───────────────────────────────────────────

  it('codex exec mode emits approval_policy=never and workspace sandbox', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      model: 'codex-4o',
      codexMode: 'exec',
    });
    expect(script).toMatch(/codex exec/);
    expect(script).toMatch(/-m 'codex-4o'/);
    expect(script).toMatch(/-c approval_policy=never/);
    expect(script).toMatch(/-s workspace/);
    expect(script).toMatch(/--skip-git-repo-check/);
  });

  it('codex work-tui mode emits interactive codex with only -m (approval/sandbox from config.toml)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      model: 'codex-4o',
      codexMode: 'work-tui',
    });
    // PAN-1803: approval_policy/sandbox_mode come from the seeded config.toml
    // (Settings-driven), NOT CLI flags that would override the user's choice.
    expect(script).toMatch(/^exec codex -m 'codex-4o'$/m);
    expect(script).not.toMatch(/codex exec/);
    expect(script).not.toMatch(/approval_policy=never/);
    expect(script).not.toMatch(/-s workspace-write/);
  });

  it('codex work-tui mode RESUMES the thread when resumeSessionId is set (PAN-1988)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      model: 'codex-4o',
      codexMode: 'work-tui',
      resumeSessionId: '019ee5e7-thread-abc',
    });
    // The work-tui branch MUST apply `codex resume <id>`. Dropping it (the original bug) made every
    // re-dispatch open a FRESH codex session and re-research the whole diff, losing prior context.
    expect(script).toMatch(/^exec codex resume -m 'codex-4o' '019ee5e7-thread-abc'$/m);
  });

  it('codex work-tui mode can be wrapped by the PTY supervisor', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      model: 'codex-4o',
      codexMode: 'work-tui',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    expect(script).toMatch(/^exec node '\/dist\/pty-supervisor\.js' codex -m 'codex-4o'$/m);
    expect(script).not.toMatch(/codex exec/);
  });

  it('codex conversation (tui) mode disables project AGENTS.md without supervisor', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'tui',
      spawnMode: 'conversation',
    });
    expect(script).toMatch(/^codex -c project_doc_max_bytes=0$/m);
    expect(script).not.toMatch(/codex exec/);
  });

  it('codex conversation (tui) mode can be wrapped by the PTY supervisor', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'tui',
      spawnMode: 'conversation',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    expect(script).toMatch(/^node '\/dist\/pty-supervisor\.js' codex -c project_doc_max_bytes=0$/m);
    expect(script).not.toMatch(/codex exec/);
  });

  it('codex conversation (tui) resume uses interactive codex resume', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'tui',
      spawnMode: 'conversation',
      resumeSessionId: '019eaaec-4dfa-7ab1-90ba-9104d16534d1',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    expect(script).toMatch(/^node '\/dist\/pty-supervisor\.js' codex resume -c project_doc_max_bytes=0 '019eaaec-4dfa-7ab1-90ba-9104d16534d1'$/m);
    expect(script).not.toMatch(/codex exec/);
  });

  it('codex exec mode stays off the PTY supervisor', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      model: 'codex-4o',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    expect(script).not.toMatch(/pty-supervisor/);
    expect(script).toMatch(/codex exec/);
  });

  it('codex exports CODEX_HOME env var when codexHome is set', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      model: 'codex-4o',
      codexHome: '/home/user/.overdeck/agents/agent-1/codex-home',
    });
    expect(script).toMatch(/export CODEX_HOME='\/home\/user\/.overdeck\/agents\/agent-1\/codex-home'/);
  });

  it('claude-code (default) output is bit-for-bit unchanged when harness is unset (AC3)', () => {
    const a = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    const b = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'claude-code',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(a).toBe(b);
  });
});

describe('pi model provider qualification (PAN-1799)', () => {
  it('qualifies kimi models with the kimi-coding pi provider', async () => {
    const { qualifyPiModel } = await import('../providers.js');
    expect(qualifyPiModel('kimi-k2.6')).toBe('kimi-coding/kimi-k2.6');
  });
  it('qualifies openai models with openai-codex; unknown ids inherit the anthropic default (parity with conversations)', async () => {
    const { qualifyPiModel } = await import('../providers.js');
    expect(qualifyPiModel('gpt-5.5')).toBe('openai-codex/gpt-5.5');
    // getProviderForModelSync falls back to anthropic for unknown ids — the
    // same behavior conversations.ts has always had for pi model resolution.
    expect(qualifyPiModel('totally-unknown-model')).toBe('anthropic/totally-unknown-model');
  });
});
