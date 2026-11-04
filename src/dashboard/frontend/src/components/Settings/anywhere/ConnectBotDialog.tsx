/**
 * PAN-4927 W-BOT1 (PAN-4951): "Connect a bot" — one form (D-5) that gives an outside MCP
 * client (Hermes, OpenClaw, Grok Build, Grok Bot, the xAI API) scoped, revocable access to
 * this machine. Only the connector reach is wired here; tailscale, this-computer and public
 * land with dialog-token-reaches and dialog-public-reach.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { apiError, isOk } from './anywhereApi';
import {
  BOT_PLATFORMS,
  REACH_LABELS,
  defaultBotName,
  type BotPlatform,
  type BotReach,
} from './botSnippets';
import {
  BOTS_CONNECTORS_QUERY_KEY,
  BOT_DEFAULT_SCOPES,
  BOT_SCOPE_CHOICES,
  type BotScope,
  botScopes,
  createConnectorPairing,
} from './botsApi';
import { ConnectBotOutput } from './ConnectBotOutput';

const TICKABLE_SCOPES = BOT_SCOPE_CHOICES.filter((scope) => scope !== 'read:state');

const SCOPE_INFO: Record<BotScope, { label: string; hint?: string }> = {
  'read:state': { label: 'Read state' },
  'read:conversations': { label: 'Read conversations' },
  tell: { label: 'Send messages' },
  operate: { label: 'Operate', hint: 'can start and stop work' },
  approve: { label: 'Approve', hint: 'can answer questions and permission prompts' },
};

interface ConnectBotDialogProps {
  open: boolean;
  onClose: () => void;
}

interface PairingOutput {
  pairingString: string;
  expiresAt: string;
}

function defaultTicked(): Set<BotScope> {
  return new Set(BOT_DEFAULT_SCOPES.filter((scope) => scope !== 'read:state'));
}

export function ConnectBotDialog({ open, onClose }: ConnectBotDialogProps) {
  if (!open) return null;
  return <ConnectBotDialogBody onClose={onClose} />;
}

function ConnectBotDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<BotPlatform>('hermes');
  const [reach, setReach] = useState<BotReach>(BOT_PLATFORMS[0]!.reaches[0]!);
  const [ticked, setTicked] = useState<Set<BotScope>>(defaultTicked());
  const [name, setName] = useState(defaultBotName('hermes'));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [output, setOutput] = useState<PairingOutput | null>(null);

  const platformEntry = BOT_PLATFORMS.find((entry) => entry.id === platform) ?? BOT_PLATFORMS[0]!;

  const handlePlatformChange = (next: BotPlatform) => {
    const entry = BOT_PLATFORMS.find((candidate) => candidate.id === next) ?? BOT_PLATFORMS[0]!;
    setPlatform(next);
    setReach(entry.reaches[0]!);
    setName(defaultBotName(next));
    setOutput(null);
    setForbidden(false);
    setError(null);
  };

  const toggleScope = (scope: BotScope, checked: boolean) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(scope);
      else next.delete(scope);
      return next;
    });
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await createConnectorPairing(name.trim(), botScopes(ticked));
      if (result.status === 403) {
        setForbidden(true);
        return;
      }
      if (!isOk(result)) {
        setError(apiError(result));
        return;
      }
      setOutput(result.body);
      void queryClient.invalidateQueries({ queryKey: BOTS_CONNECTORS_QUERY_KEY });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const canSubmit = reach === 'connector' && name.trim().length > 0 && !creating;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-bot-title"
        data-component="connect-bot-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="connect-bot-title" className="text-base font-medium text-foreground">Connect a bot</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {output ? (
            <ConnectBotOutput platform={platform} pairingString={output.pairingString} expiresAt={output.expiresAt} onDone={onClose} />
          ) : (
            <>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">1. Platform</span>
                <div className="flex flex-wrap gap-3">
                  {BOT_PLATFORMS.map((entry) => (
                    <label key={entry.id} className="flex items-center gap-1.5 text-xs text-foreground">
                      <input
                        type="radio"
                        name="connect-bot-platform"
                        checked={platform === entry.id}
                        onChange={() => handlePlatformChange(entry.id)}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">2. Reach</span>
                <div className="flex flex-wrap gap-3">
                  {platformEntry.reaches.map((candidate) => (
                    <label key={candidate} className="flex items-center gap-1.5 text-xs text-foreground">
                      <input
                        type="radio"
                        name="connect-bot-reach"
                        checked={reach === candidate}
                        onChange={() => setReach(candidate)}
                      />
                      {REACH_LABELS[candidate]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">3. Access</span>
                {platform === 'grok-bot' ? (
                  <p className="text-xs text-foreground">
                    You choose the access level when you approve the sign-in in this dashboard.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input type="checkbox" checked disabled />
                      {SCOPE_INFO['read:state'].label} (always on)
                    </label>
                    {TICKABLE_SCOPES.map((scope) => (
                      <label key={scope} className="flex items-center gap-2 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={ticked.has(scope)}
                          onChange={(e) => toggleScope(scope, e.target.checked)}
                        />
                        {SCOPE_INFO[scope].label}
                        {SCOPE_INFO[scope].hint && <span className="text-muted-foreground">({SCOPE_INFO[scope].hint})</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="connect-bot-name" className="text-xs text-muted-foreground">Name</label>
                <input
                  id="connect-bot-name"
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                />
              </div>

              {forbidden ? (
                <p className="text-xs text-muted-foreground">Only a browser on this machine can connect bots.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!canSubmit}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {reach === 'connector' ? 'Create pairing code' : 'Connect'}
                </button>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
