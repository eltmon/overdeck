import { ShieldCheck } from 'lucide-react';
import { type SettingsConfig } from '../types';

type ClaudePermissionMode = 'auto' | 'bypass';
type CodexPermissionMode = 'read-only' | 'workspace' | 'auto-review' | 'full-access';

interface PermissionsSectionProps {
  formData: SettingsConfig;
  onClaudePermissionModeChange: (mode: ClaudePermissionMode) => void;
  onCodexPermissionModeChange: (mode: CodexPermissionMode) => void;
}

export function PermissionsSection({
  formData,
  onClaudePermissionModeChange,
  onCodexPermissionModeChange,
}: PermissionsSectionProps) {
  return (
    <section id="permissions" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        Permissions
      </h2>
      <p className="text-xs text-muted-foreground mb-6">
        How spawned agents are gated, configured per harness. Applies to work agents, specialists,
        conversations, and remote agents.
      </p>

      {/* Claude Code */}
      <div className="mb-6">
        <p className="text-xs font-medium text-foreground mb-1">Claude Code</p>
        <p className="text-xs text-muted-foreground mb-3">
          Override per-invocation with{' '}
          <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">--yolo</code>,{' '}
          <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">--no-yolo</code>, or{' '}
          <code className="text-foreground/80 bg-muted px-1 py-0.5 rounded">PAN_YOLO</code>.
        </p>
        <div className="space-y-2">
          {([
            {
              value: 'auto' as const,
              title: 'Auto (recommended)',
              flag: '--permission-mode auto',
              description:
                "Claude Code's built-in classifier auto-approves safe tool calls and blocks destructive ones (force pushes, exfiltration, rm -rf, writes outside workspace). Requires skipAutoPermissionPrompt: true in ~/.claude/settings.json.",
            },
            {
              value: 'bypass' as const,
              title: 'Bypass (yolo)',
              flag: '--permission-mode bypassPermissions',
              description:
                'Every tool call auto-approved with no classifier — fastest, but the agent can do anything its file/network access allows. Use when the classifier interferes with intentionally destructive automation.',
            },
          ]).map((opt) => {
            const selected = (formData.claude?.permissionMode ?? 'auto') === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`permission-mode-${opt.value}`}
                onClick={() => onClaudePermissionModeChange(opt.value)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-transparent hover:bg-muted/30'
                }`}
              >
                <span
                  className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-primary' : 'border-muted-foreground/40'
                  }`}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{opt.title}</span>
                    <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {opt.flag}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {opt.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Codex */}
      <div>
        <p className="text-xs font-medium text-foreground mb-1">Codex</p>
        <p className="text-xs text-muted-foreground mb-3">
          Applies to Codex TUI conversation sessions. Takes effect on the next resume or new conversation.
        </p>
        <div className="space-y-2">
          {([
            {
              value: 'read-only' as const,
              title: 'Read-only',
              flag: 'approval_policy=on-request + sandbox=read-only',
              description:
                'Codex can browse files but asks before making any changes or running commands.',
            },
            {
              value: 'workspace' as const,
              title: 'Workspace',
              flag: 'approval_policy=on-request + sandbox=workspace-write',
              description:
                'Codex works freely inside the working directory, but asks before going outside it or using the network.',
            },
            {
              value: 'auto-review' as const,
              title: 'Auto-review (recommended)',
              flag: 'approvals_reviewer=auto_review + sandbox=workspace-write',
              description:
                'A sub-agent automatically reviews and answers approval requests instead of prompting you. Codex still runs inside the workspace sandbox — the reviewer decides whether to allow escapes.',
            },
            {
              value: 'full-access' as const,
              title: 'Full access (yolo)',
              flag: 'approval_policy=never + sandbox=danger-full-access',
              description:
                'No approval prompts — Codex has full filesystem and network access. Use with care.',
            },
          ]).map((opt) => {
            const selected = (formData.codex?.permissionMode ?? 'auto-review') === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`codex-permission-mode-${opt.value}`}
                onClick={() => onCodexPermissionModeChange(opt.value)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-transparent hover:bg-muted/30'
                }`}
              >
                <span
                  className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-primary' : 'border-muted-foreground/40'
                  }`}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{opt.title}</span>
                    <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {opt.flag}
                    </code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {opt.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
