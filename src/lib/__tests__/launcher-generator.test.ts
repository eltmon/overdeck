import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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

function materializeGitGuard(): { script: string; wrapperPath: string; worktree: string; outside: string } {
  const realGitDir = join(tempHome, 'real-git');
  const realGitPath = join(realGitDir, 'git');
  const launcherPath = join(tempHome, 'launcher.sh');
  // PAN-3189: the guard scopes to the agent's worktree, so both it and an
  // unrelated directory (standing in for a fixture's temp repo) must exist.
  const worktree = join(tempHome, 'workspace');
  const outside = join(tempHome, 'elsewhere');
  mkdirSync(realGitDir, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(realGitPath, '#!/bin/sh\nexit 23\n');
  chmodSync(realGitPath, 0o755);

  const script = generateLauncherScriptSync({
    ...DEFAULT_CONFIG,
    workingDir: worktree,
    changeDir: false,
    overdeckEnv: { agentId: 'agent-pan-806', issueId: 'PAN-806', sessionType: 'work' },
    baseCommand: 'true',
  });
  writeFileSync(launcherPath, script);

  const launcherResult = spawnSync('bash', [launcherPath], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${realGitDir}:${process.env.PATH ?? ''}` },
  });
  if (launcherResult.status !== 0) {
    throw new Error(`Launcher failed: ${launcherResult.stderr}`);
  }

  return {
    script,
    wrapperPath: join(tempHome, 'agents', 'agent-pan-806', 'git-guard', 'git'),
    worktree,
    outside,
  };
}

describe('generateLauncherScript', () => {
  it('exports the spawning process home for non-remote launchers', () => {
    const script = generateLauncherScriptSync(DEFAULT_CONFIG);
    expect(script).toContain(`export OVERDECK_HOME='${tempHome}'`);
  });

  it('omits the spawning process home from remote launchers', () => {
    const script = generateLauncherScriptSync({ ...DEFAULT_CONFIG, spawnMode: 'remote' });
    expect(script).not.toContain('export OVERDECK_HOME=');
  });

  it('reflects a changed process home in non-remote launchers', () => {
    const alternateHome = join(tempHome, 'alternate home');
    process.env.OVERDECK_HOME = alternateHome;
    const script = generateLauncherScriptSync(DEFAULT_CONFIG);
    expect(script).toContain(`export OVERDECK_HOME='${alternateHome}'`);
  });

  it('work agent spawn (basic)', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      baseCommand: 'claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6',
    });
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export SKIP_DOCS_INDEX=1
      cd -- '/workspace/project'
      export ANTHROPIC_BASE_URL="http://proxy"
      exec claude --agent pan-work-agent --resume 'sess-123' --model 'gpt-5.4'
      "
    `);
  });

  it('adds the git guard only to issue-bound agent launchers', () => {
    const { script } = materializeGitGuard();
    expect(script).toContain('_OVERDECK_REAL_GIT="$(command -v git)"');
    expect(script).toContain("agents/agent-pan-806/git-guard/git");
    expect(script).toContain('export PATH="');
    expect(script).toContain('git-guard:$PATH"');

    const conversationScript = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      spawnMode: 'conversation',
      overdeckEnv: { agentId: 'conv-123', issueId: 'PAN-806' },
      baseCommand: 'claude',
    });
    expect(conversationScript).not.toContain('_OVERDECK_REAL_GIT');
    expect(conversationScript).not.toContain('git-guard');
  });

  it('blocks history operations and passes permitted git commands to real git', () => {
    const { wrapperPath, worktree } = materializeGitGuard();
    const run = (args: string[]) => spawnSync(wrapperPath, args, {
      cwd: worktree,
      encoding: 'utf-8',
      env: { ...process.env, OVERDECK_PAN_GIT_OP: '' },
    });

    for (const args of [
      ['rebase', 'main'],
      ['reset', '--hard', 'HEAD'],
      ['stash', 'push'],
      ['-C', worktree, 'rebase', 'main'],
      [`-C${worktree}`, 'reset', '--hard', 'HEAD'],
      ['-c', 'core.hooksPath=/tmp/hooks', 'stash', 'push'],
      ['-ccore.hooksPath=/tmp/hooks', 'rebase', 'main'],
    ]) {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Overdeck agents must not run git');
    }
    for (const args of [['status'], ['add', '.'], ['fetch', 'origin']]) {
      expect(run(args).status).toBe(23);
    }
  });

  it('leaves history operations outside the agent worktree alone (PAN-3189)', () => {
    const { wrapperPath, outside } = materializeGitGuard();
    const run = (args: string[]) => spawnSync(wrapperPath, args, {
      cwd: outside,
      encoding: 'utf-8',
      env: { ...process.env, OVERDECK_PAN_GIT_OP: '' },
    });

    for (const args of [['rebase', 'main'], ['reset', '--hard', 'HEAD'], ['stash', 'push']]) {
      const result = run(args);
      expect(result.stderr).not.toContain('Overdeck agents must not run git');
      expect(result.status).toBe(23);
    }
  });

  it('strips an inherited guard dir from PATH before installing its own (PAN-3189)', () => {
    const foreignGuardDir = join(tempHome, 'agents', 'flywheel-orchestrator', 'git-guard');
    mkdirSync(foreignGuardDir, { recursive: true });
    writeFileSync(join(foreignGuardDir, 'git'), '#!/bin/sh\nexit 77\n');
    chmodSync(join(foreignGuardDir, 'git'), 0o755);

    const worktree = join(tempHome, 'workspace');
    mkdirSync(worktree, { recursive: true });
    const launcherPath = join(tempHome, 'inherited-guard-launcher.sh');
    writeFileSync(launcherPath, generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      workingDir: worktree,
      changeDir: false,
      overdeckEnv: { agentId: 'agent-pan-3189', issueId: 'PAN-3189', sessionType: 'work' },
      baseCommand: 'printenv PATH',
    }));

    const result = spawnSync('bash', [launcherPath], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${foreignGuardDir}:${process.env.PATH ?? ''}` },
    });

    expect(result.status).toBe(0);
    const guardSegments = result.stdout.trim().split(':').filter(segment => segment.endsWith('/git-guard'));
    expect(guardSegments).toEqual([join(tempHome, 'agents', 'agent-pan-3189', 'git-guard')]);
  });

  it('passes every git command through when the pan git-op sentinel is set', () => {
    const { wrapperPath, worktree } = materializeGitGuard();
    const run = (args: string[]) => spawnSync(wrapperPath, args, {
      cwd: worktree,
      encoding: 'utf-8',
      env: { ...process.env, OVERDECK_PAN_GIT_OP: '1' },
    });

    for (const args of [['rebase', 'main'], ['reset', '--hard', 'HEAD'], ['stash', 'push']]) {
      const result = run(args);
      expect(result.status).toBe(23);
      expect(result.stderr).not.toContain('Overdeck agents must not run git');
    }
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
      IFS=':' read -r -a _overdeck_path_segments <<< "$PATH"
      _overdeck_kept_path=()
      for _overdeck_path_segment in "\${_overdeck_path_segments[@]}"; do
        [[ "$_overdeck_path_segment" == */git-guard ]] || _overdeck_kept_path+=("$_overdeck_path_segment")
      done
      PATH="$(IFS=':'; echo "\${_overdeck_kept_path[*]}")"
      unset _overdeck_path_segments _overdeck_kept_path _overdeck_path_segment
      _OVERDECK_REAL_GIT="$(command -v git)"
      _OVERDECK_GUARD_ROOT="$(cd '/workspace/project' 2>/dev/null && pwd -P)"
      [ -n "$_OVERDECK_GUARD_ROOT" ] || _OVERDECK_GUARD_ROOT='/workspace/project'
      mkdir -p '<OVERDECK_HOME>/agents/plan-abc/git-guard'
      cat > '<OVERDECK_HOME>/agents/plan-abc/git-guard/git' <<EOF
      #!/bin/sh
      _OVERDECK_REAL_GIT="$_OVERDECK_REAL_GIT"
      _OVERDECK_GUARD_ROOT="$_OVERDECK_GUARD_ROOT"
      if [ "\\$OVERDECK_PAN_GIT_OP" = "1" ]; then
        exec "\\$_OVERDECK_REAL_GIT" "\\$@"
      fi
      _overdeck_git_find_command() {
        while [ "\\$#" -gt 0 ]; do
          case "\\$1" in
            -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)
              shift
              [ "\\$#" -gt 0 ] && shift
              ;;
            -C?*|-c?*|--git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--super-prefix=*|--attr-source=*)
              shift
              ;;
            --)
              shift
              break
              ;;
            -*)
              shift
              ;;
            *)
              printf "%s\\n" "\\$1"
              return
              ;;
          esac
        done
        [ "\\$#" -gt 0 ] && printf "%s\\n" "\\$1"
      }
      _overdeck_git_target_dir() {
        _overdeck_dir="\\$(pwd -P 2>/dev/null || pwd)"
        while [ "\\$#" -gt 0 ]; do
          case "\\$1" in
            -C)
              shift
              [ "\\$#" -gt 0 ] || break
              case "\\$1" in
                /*) _overdeck_dir="\\$1" ;;
                *) _overdeck_dir="\\$_overdeck_dir/\\$1" ;;
              esac
              shift
              ;;
            -C?*)
              _overdeck_c_value="\\\${1#-C}"
              case "\\$_overdeck_c_value" in
                /*) _overdeck_dir="\\$_overdeck_c_value" ;;
                *) _overdeck_dir="\\$_overdeck_dir/\\$_overdeck_c_value" ;;
              esac
              shift
              ;;
            -c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)
              shift
              [ "\\$#" -gt 0 ] && shift
              ;;
            -c?*|--git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--super-prefix=*|--attr-source=*)
              shift
              ;;
            --)
              break
              ;;
            -*)
              shift
              ;;
            *)
              break
              ;;
          esac
        done
        if [ -d "\\$_overdeck_dir" ]; then
          (cd "\\$_overdeck_dir" 2>/dev/null && pwd -P) || printf "%s\\n" "\\$_overdeck_dir"
        else
          printf "%s\\n" "\\$_overdeck_dir"
        fi
      }
      _overdeck_git_command="\\$(_overdeck_git_find_command "\\$@")"
      case "\\$_overdeck_git_command" in
        rebase|stash|reset) ;;
        *) exec "\\$_OVERDECK_REAL_GIT" "\\$@" ;;
      esac
      _overdeck_git_target="\\$(_overdeck_git_target_dir "\\$@")"
      case "\\$_overdeck_git_target" in
        "\\$_OVERDECK_GUARD_ROOT"|"\\$_OVERDECK_GUARD_ROOT"/*) ;;
        *) exec "\\$_OVERDECK_REAL_GIT" "\\$@" ;;
      esac
      case "\\$_overdeck_git_command" in
        rebase)
          echo "Overdeck agents must not run git rebase directly. Use pan sync-main to sync main or pan done to submit." >&2
          exit 1
          ;;
        stash)
          _overdeck_stash_sub=""
          _overdeck_after_stash=0
          for _overdeck_git_arg in "\\$@"; do
            if [ "\\$_overdeck_after_stash" = "1" ]; then
              case "\\$_overdeck_git_arg" in
                -*) ;;
                *)
                  _overdeck_stash_sub="\\$_overdeck_git_arg"
                  break
                  ;;
              esac
            elif [ "\\$_overdeck_git_arg" = "stash" ]; then
              _overdeck_after_stash=1
            fi
          done
          case "\\$_overdeck_stash_sub" in
            list|show)
              ;;
            *)
              echo "Overdeck agents must not run git stash directly (read-only stash list/show are allowed). Use pan sync-main to sync main or pan done to submit." >&2
              exit 1
              ;;
          esac
          ;;
        reset)
          for _overdeck_git_arg in "\\$@"; do
            if [ "\\$_overdeck_git_arg" = "--hard" ]; then
              echo "Overdeck agents must not run git reset --hard. Commit, explicitly discard, or surface the state instead." >&2
              exit 1
            fi
          done
          ;;
      esac
      exec "\\$_OVERDECK_REAL_GIT" "\\$@"
      EOF
      chmod 0755 '<OVERDECK_HOME>/agents/plan-abc/git-guard/git'
      export PATH="<OVERDECK_HOME>/agents/plan-abc/git-guard:$PATH"
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
      set -o pipefail
      command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
      export SKIP_DOCS_INDEX=1
      export OVERDECK_AGENT_ID='spec-123'
      export OVERDECK_ISSUE_ID='PAN-824'
      export OVERDECK_SESSION_TYPE='correctness-review'
      IFS=':' read -r -a _overdeck_path_segments <<< "$PATH"
      _overdeck_kept_path=()
      for _overdeck_path_segment in "\${_overdeck_path_segments[@]}"; do
        [[ "$_overdeck_path_segment" == */git-guard ]] || _overdeck_kept_path+=("$_overdeck_path_segment")
      done
      PATH="$(IFS=':'; echo "\${_overdeck_kept_path[*]}")"
      unset _overdeck_path_segments _overdeck_kept_path _overdeck_path_segment
      _OVERDECK_REAL_GIT="$(command -v git)"
      _OVERDECK_GUARD_ROOT="$(cd '/workspace/project' 2>/dev/null && pwd -P)"
      [ -n "$_OVERDECK_GUARD_ROOT" ] || _OVERDECK_GUARD_ROOT='/workspace/project'
      mkdir -p '<OVERDECK_HOME>/agents/spec-123/git-guard'
      cat > '<OVERDECK_HOME>/agents/spec-123/git-guard/git' <<EOF
      #!/bin/sh
      _OVERDECK_REAL_GIT="$_OVERDECK_REAL_GIT"
      _OVERDECK_GUARD_ROOT="$_OVERDECK_GUARD_ROOT"
      if [ "\\$OVERDECK_PAN_GIT_OP" = "1" ]; then
        exec "\\$_OVERDECK_REAL_GIT" "\\$@"
      fi
      _overdeck_git_find_command() {
        while [ "\\$#" -gt 0 ]; do
          case "\\$1" in
            -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)
              shift
              [ "\\$#" -gt 0 ] && shift
              ;;
            -C?*|-c?*|--git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--super-prefix=*|--attr-source=*)
              shift
              ;;
            --)
              shift
              break
              ;;
            -*)
              shift
              ;;
            *)
              printf "%s\\n" "\\$1"
              return
              ;;
          esac
        done
        [ "\\$#" -gt 0 ] && printf "%s\\n" "\\$1"
      }
      _overdeck_git_target_dir() {
        _overdeck_dir="\\$(pwd -P 2>/dev/null || pwd)"
        while [ "\\$#" -gt 0 ]; do
          case "\\$1" in
            -C)
              shift
              [ "\\$#" -gt 0 ] || break
              case "\\$1" in
                /*) _overdeck_dir="\\$1" ;;
                *) _overdeck_dir="\\$_overdeck_dir/\\$1" ;;
              esac
              shift
              ;;
            -C?*)
              _overdeck_c_value="\\\${1#-C}"
              case "\\$_overdeck_c_value" in
                /*) _overdeck_dir="\\$_overdeck_c_value" ;;
                *) _overdeck_dir="\\$_overdeck_dir/\\$_overdeck_c_value" ;;
              esac
              shift
              ;;
            -c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)
              shift
              [ "\\$#" -gt 0 ] && shift
              ;;
            -c?*|--git-dir=*|--work-tree=*|--namespace=*|--config-env=*|--super-prefix=*|--attr-source=*)
              shift
              ;;
            --)
              break
              ;;
            -*)
              shift
              ;;
            *)
              break
              ;;
          esac
        done
        if [ -d "\\$_overdeck_dir" ]; then
          (cd "\\$_overdeck_dir" 2>/dev/null && pwd -P) || printf "%s\\n" "\\$_overdeck_dir"
        else
          printf "%s\\n" "\\$_overdeck_dir"
        fi
      }
      _overdeck_git_command="\\$(_overdeck_git_find_command "\\$@")"
      case "\\$_overdeck_git_command" in
        rebase|stash|reset) ;;
        *) exec "\\$_OVERDECK_REAL_GIT" "\\$@" ;;
      esac
      _overdeck_git_target="\\$(_overdeck_git_target_dir "\\$@")"
      case "\\$_overdeck_git_target" in
        "\\$_OVERDECK_GUARD_ROOT"|"\\$_OVERDECK_GUARD_ROOT"/*) ;;
        *) exec "\\$_OVERDECK_REAL_GIT" "\\$@" ;;
      esac
      case "\\$_overdeck_git_command" in
        rebase)
          echo "Overdeck agents must not run git rebase directly. Use pan sync-main to sync main or pan done to submit." >&2
          exit 1
          ;;
        stash)
          _overdeck_stash_sub=""
          _overdeck_after_stash=0
          for _overdeck_git_arg in "\\$@"; do
            if [ "\\$_overdeck_after_stash" = "1" ]; then
              case "\\$_overdeck_git_arg" in
                -*) ;;
                *)
                  _overdeck_stash_sub="\\$_overdeck_git_arg"
                  break
                  ;;
              esac
            elif [ "\\$_overdeck_git_arg" = "stash" ]; then
              _overdeck_after_stash=1
            fi
          done
          case "\\$_overdeck_stash_sub" in
            list|show)
              ;;
            *)
              echo "Overdeck agents must not run git stash directly (read-only stash list/show are allowed). Use pan sync-main to sync main or pan done to submit." >&2
              exit 1
              ;;
          esac
          ;;
        reset)
          for _overdeck_git_arg in "\\$@"; do
            if [ "\\$_overdeck_git_arg" = "--hard" ]; then
              echo "Overdeck agents must not run git reset --hard. Commit, explicitly discard, or surface the state instead." >&2
              exit 1
            fi
          done
          ;;
      esac
      exec "\\$_OVERDECK_REAL_GIT" "\\$@"
      EOF
      chmod 0755 '<OVERDECK_HOME>/agents/spec-123/git-guard/git'
      export PATH="<OVERDECK_HOME>/agents/spec-123/git-guard:$PATH"
      cd -- '/workspace/project'
      unset ANTHROPIC_API_KEY
      unset ANTHROPIC_BASE_URL
      unset ANTHROPIC_AUTH_TOKEN
      unset OPENAI_API_KEY
      unset GEMINI_API_KEY
      unset API_TIMEOUT_MS
      unset CLAUDE_CODE_API_KEY_HELPER_TTL_MS
      unset CLAUDE_CODE_AUTO_COMPACT_WINDOW
      unset CLAUDE_CODE_MAX_CONTEXT_TOKENS
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
      unset CLAUDE_CODE_AUTO_COMPACT_WINDOW
      unset CLAUDE_CODE_MAX_CONTEXT_TOKENS
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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
    expect(script.replaceAll(tempHome, '<OVERDECK_HOME>')).toMatchInlineSnapshot(`
      "#!/bin/bash
      export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"
      unset TMUX TMUX_PANE STY
      export OVERDECK_HOME='<OVERDECK_HOME>'
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

    it('flag-off: omits channels bridge arguments', () => {
      const script = generateLauncherScriptSync(FIXTURE_CONFIG);
      expect(script).toBe(
        [
          '#!/bin/bash',
          'export OVERDECK_HOST_TMUX="$TMUX" OVERDECK_HOST_TMUX_PANE="$TMUX_PANE"',
          'unset TMUX TMUX_PANE STY',
          `export OVERDECK_HOME='${tempHome}'`,
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

  it('codex app-server mode launches the host without the PTY supervisor', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'app-server',
      spawnMode: 'conversation',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    expect(script).toMatch(/^node '.+\/dist\/codex-app-server-host\.js'$/m);
    expect(script).not.toMatch(/pty-supervisor/);
    expect(script).not.toMatch(/codex exec/);
    expect(script).not.toMatch(/ -m /);
  });

  it('codex app-server mode resumes by thread id', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'app-server',
      resumeSessionId: '019ee5e7-thread-abc',
    });
    expect(script).toMatch(/^exec node '.+\/dist\/codex-app-server-host\.js' --resume '019ee5e7-thread-abc'$/m);
  });

  it('acp mode launches the authenticated host in an isolated provider environment', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'acp',
      acpAgentId: 'agent-pan-2858',
      acpProvider: 'kimi',
      acpWorkspace: '/workspace/project',
      acpBinaryPath: '/opt/kimi code/bin/kimi',
      acpContextFile: '/home/user/.overdeck/agents/agent-pan-2858/acp-context.md',
      model: 'kimi-for-coding',
      resumeSessionId: 'kimi-session-2858',
      overdeckEnv: { agentId: 'agent-pan-2858' },
      unsetProviderEnv: true,
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });

    expect(script).toMatch(/export OVERDECK_AGENT_ID='agent-pan-2858'/);
    expect(script).toMatch(
      /^exec node '.+\/dist\/acp-host\.js' --agent 'agent-pan-2858' --provider 'kimi' --workspace '\/workspace\/project' --binary-path '\/opt\/kimi code\/bin\/kimi' --resume 'kimi-session-2858' --model 'kimi-for-coding' --context-file '\/home\/user\/\.overdeck\/agents\/agent-pan-2858\/acp-context\.md'$/m,
    );
    expect(script).toContain('unset ANTHROPIC_API_KEY');
    expect(script).toContain('unset ANTHROPIC_BASE_URL');
    expect(script).toContain('unset ANTHROPIC_AUTH_TOKEN');
    expect(script).not.toMatch(/export ANTHROPIC_(?:API_KEY|BASE_URL|AUTH_TOKEN)=/);
    expect(script).not.toContain('initial-prompt');
    expect(script).not.toContain('--append-system-prompt-file');
    expect(script).not.toContain('pty-supervisor');
  });

  it('acp mode refuses to launch without the preflight-resolved binary path', () => {
    expect(() => generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'acp',
      acpAgentId: 'agent-pan-2858',
      acpProvider: 'kimi',
      acpWorkspace: '/workspace/project',
      model: 'kimi-for-coding',
    })).toThrow('acp launcher requires acpBinaryPath');
  });

  it('codex tui escape hatch preserves the previous conversation command byte-for-byte', () => {
    const legacy = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'tui',
      spawnMode: 'conversation',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    const escapeHatch = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'work',
      harness: 'codex',
      codexMode: 'tui',
      spawnMode: 'conversation',
      useSupervisor: true,
      supervisorScriptPath: '/dist/pty-supervisor.js',
    });
    expect(escapeHatch).toBe(legacy);
    expect(escapeHatch).toMatch(/^node '\/dist\/pty-supervisor\.js' codex -c project_doc_max_bytes=0$/m);
  });

  it('codex plan launchers do not receive Claude-only append-system-prompt flags', () => {
    const script = generateLauncherScriptSync({
      ...DEFAULT_CONFIG,
      role: 'plan',
      harness: 'codex',
      model: 'gpt-5.5',
      codexMode: 'work-tui',
      appendSystemPromptFiles: ['/workspace/project/.pan/context.md'],
    });
    expect(script).toMatch(/^codex -m 'gpt-5\.5'$/m);
    expect(script).not.toMatch(/--append-system-prompt-file/);
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

  describe('kimi-code harness (PAN-1837)', () => {
    it('launches the native kimi TUI wrapped in the PTY supervisor with an isolated provider environment', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
        kimiCodeYolo: true,
        overdeckEnv: { agentId: 'agent-pan-1837' },
        unsetProviderEnv: true,
        useSupervisor: true,
        supervisorScriptPath: '/dist/pty-supervisor.js',
      });

      expect(script).toMatch(/^exec node '\/dist\/pty-supervisor\.js' kimi -m 'kimi-code\/k3-256k' --yolo$/m);
      expect(script).toContain('unset ANTHROPIC_API_KEY');
      expect(script).toContain('unset ANTHROPIC_BASE_URL');
      expect(script).toContain('unset ANTHROPIC_AUTH_TOKEN');
      expect(script).not.toMatch(/export ANTHROPIC_(?:API_KEY|BASE_URL|AUTH_TOKEN)=/);
    });

    it('never emits --session (long form), --work-dir, or -p/--print (D2/erratum E1)', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
        kimiCodeYolo: true,
        promptFile: '/workspace/project/.pan/init-prompt.txt',
      });
      expect(script).not.toMatch(/--session\b/);
      expect(script).not.toMatch(/--work-dir/);
      expect(script).not.toMatch(/(^|\s)-p(\s|$)/);
      expect(script).not.toMatch(/--print/);
    });

    it('resumes a captured session id via -S (PAN-1837)', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
        kimiCodeYolo: true,
        resumeSessionId: 'session-abc-123',
      });
      expect(script).toMatch(/^exec kimi -m 'kimi-code\/k3-256k' -S 'session-abc-123' --yolo$/m);
    });

    it('omits -S when no resumeSessionId is set (fresh launch)', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
        kimiCodeYolo: true,
      });
      expect(script).not.toMatch(/-S /);
    });

    it('appends --add-dir once per configured directory', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
        kimiCodeYolo: true,
        kimiCodeAddDirs: ['/workspace/other-repo', '/workspace/third'],
      });
      expect(script).toMatch(/^exec kimi -m 'kimi-code\/k3-256k' --yolo --add-dir '\/workspace\/other-repo' --add-dir '\/workspace\/third'$/m);
    });

    it('omits --yolo when kimiCodeYolo is not set', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
      });
      expect(script).toMatch(/^exec kimi -m 'kimi-code\/k3-256k'$/m);
      expect(script).not.toMatch(/--yolo/);
    });

    it('refuses to launch without a configured model', () => {
      expect(() => generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
      })).toThrow('kimi-code launcher requires kimiCodeModel');
    });

    it('conversation panel mode wraps the same command under the PTY supervisor', () => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'k3',
        kimiCodeYolo: true,
        spawnMode: 'conversation',
        useSupervisor: true,
        supervisorScriptPath: '/dist/pty-supervisor.js',
      });
      expect(script).toMatch(/^node '\/dist\/pty-supervisor\.js' kimi -m 'kimi-code\/k3-256k' --yolo$/m);
      expect(script).not.toMatch(/^exec /m);
    });

    // The CLI only accepts ids from its own config.toml catalog. Translating at
    // this chokepoint — not at each caller — is what makes an untranslated id
    // impossible: the conversation and runtime spawn paths both passed raw
    // Overdeck ids, and `kimi -m 'k3[1m]'` died with `[config.invalid]`.
    it.each([
      ['k3', "kimi-code/k3-256k"],
      ['k3[1m]', "kimi-code/k3"],
      ['kimi-k2.7-code', "kimi-code/kimi-for-coding"],
      ['kimi-code/k3', "kimi-code/k3"],
      ['kimi-code/kimi-for-coding-highspeed', "kimi-code/kimi-for-coding-highspeed"],
    ])('translates the Overdeck model id %s to the CLI catalog id %s', (given, expected) => {
      const script = generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: given,
      });
      expect(script).toContain(`kimi -m '${expected}'`);
    });

    it('refuses to launch a retired id the CLI catalog never carried', () => {
      expect(() => generateLauncherScriptSync({
        ...DEFAULT_CONFIG,
        role: 'work',
        harness: 'kimi-code',
        kimiCodeModel: 'kimi-k2.6',
      })).toThrow(/has no native kimi-code CLI equivalent/);
    });
  });
});

describe('pi model provider qualification (PAN-1799)', () => {
  it('qualifies kimi models with the kimi-coding pi provider', async () => {
    const { qualifyPiModel } = await import('../providers.js');
    expect(qualifyPiModel('kimi-k2.6')).toBe('kimi-coding/kimi-k2.6');
  });
  it('qualifies openai models with openai-codex and rejects unknown model ids', async () => {
    const { qualifyPiModel } = await import('../providers.js');
    expect(qualifyPiModel('gpt-5.5')).toBe('openai-codex/gpt-5.5');
    expect(() => qualifyPiModel('totally-unknown-model')).toThrow('Unknown model "totally-unknown-model".');
  });
});
