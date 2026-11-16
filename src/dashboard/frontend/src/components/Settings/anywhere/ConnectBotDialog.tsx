/**
 * PAN-4927 W-BOT1 (PAN-4951): "Connect a bot" — one form (D-5) that gives an outside MCP
 * client (Hermes, OpenClaw, Grok Build, Grok Bot, the xAI API) scoped, revocable access to
 * this machine. Every reach is wired here: connector, tailscale, this-computer and public.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import {
  ANYWHERE_ACCESS_TOKENS_QUERY_KEY,
  ANYWHERE_ENVIRONMENT_QUERY_KEY,
  ANYWHERE_PUBLIC_MCP_QUERY_KEY,
  ANYWHERE_STATUS_QUERY_KEY,
  apiError,
  createAccessToken,
  isOk,
  loadAnywhereStatus,
  loadEnvironment,
  loadPublicMcp,
} from './anywhereApi';
import {
  BOT_PLATFORMS,
  PUBLIC_MCP_PLACEHOLDER_URL,
  REACH_LABELS,
  TAILSCALE_PLACEHOLDER_ORIGIN,
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
import { connectMessageFor, connectPlatformFor, writeClipboard } from './connectMessage';
import { ConnectBotOutput, type ConnectBotResult } from './ConnectBotOutput';
import { requestSettingsSection } from '../../../lib/settingsSection';

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

function defaultTicked(): Set<BotScope> {
  return new Set(BOT_DEFAULT_SCOPES.filter((scope) => scope !== 'read:state'));
}

export function ConnectBotDialog({ open, onClose }: ConnectBotDialogProps) {
  if (!open) return null;
  return <ConnectBotDialogBody onClose={onClose} />;
}

function ConnectBotDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const { data: environment } = useQuery({ queryKey: ANYWHERE_ENVIRONMENT_QUERY_KEY, queryFn: loadEnvironment });

  const [platform, setPlatform] = useState<BotPlatform>('hermes');
  const [reach, setReach] = useState<BotReach>(BOT_PLATFORMS[0]!.reaches[0]!);
  const [ticked, setTicked] = useState<Set<BotScope>>(defaultTicked());
  const [name, setName] = useState(defaultBotName('hermes'));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [output, setOutput] = useState<ConnectBotResult | null>(null);

  // PAN-4947: the same key and loader as the Public MCP panel. A failed load (an older server
  // answers 404) leaves `publicMcp` undefined, which reads as off (D-6).
  const { data: publicMcp } = useQuery({ queryKey: ANYWHERE_PUBLIC_MCP_QUERY_KEY, queryFn: loadPublicMcp, enabled: reach === 'public' });

  const platformEntry = BOT_PLATFORMS.find((entry) => entry.id === platform) ?? BOT_PLATFORMS[0]!;
  // D-10: Tailscale Serve's URL, or the placeholder plus a "not set up" note.
  const tailscaleSetUp = Boolean(status?.tailscale.serveUrl);
  const tailscaleOrigin = (status?.tailscale.serveUrl ?? TAILSCALE_PLACEHOLDER_ORIGIN).replace(/\/+$/, '');

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
      if (reach === 'connector') {
        const connectPlatform = connectPlatformFor(platform);
        const result = await createConnectorPairing(name.trim(), botScopes(ticked), connectPlatform);
        if (result.status === 403) {
          setForbidden(true);
          return;
        }
        if (!isOk(result)) {
          setError(apiError(result));
          return;
        }
        const { pairingString, expiresAt } = result.body;
        const message = connectMessageFor({ platform: connectPlatform, botName: name.trim(), pairingString, environment });
        const copied = await writeClipboard(message);
        setOutput({ kind: 'connector', pairingString, expiresAt, message, copied });
        void queryClient.invalidateQueries({ queryKey: BOTS_CONNECTORS_QUERY_KEY });
        return;
      }
      if (reach === 'tailscale' || reach === 'this-computer') {
        const result = await createAccessToken(name.trim(), botScopes(ticked));
        if (result.status === 403) {
          setForbidden(true);
          return;
        }
        if (!isOk(result)) {
          setError(apiError(result));
          return;
        }
        setOutput({ kind: 'token', reach, token: result.body.token, origin: tailscaleOrigin, tailscaleSetUp });
        void queryClient.invalidateQueries({ queryKey: ANYWHERE_ACCESS_TOKENS_QUERY_KEY });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const canSubmit = (reach === 'connector' || reach === 'tailscale' || reach === 'this-computer')
    && name.trim().length > 0 && !creating;

  // D-7: hand off to the Public MCP panel (PublicMcpPanel, data-component="public-mcp-panel").
  const showPublicMcpSettings = () => {
    requestSettingsSection('anywhere');
    onClose();
    document.querySelector('[data-component="public-mcp-panel"]')?.scrollIntoView({ block: 'center' });
  };

  const handleShowSetup = () => {
    if (!publicMcp) return;
    setOutput({
      kind: 'public',
      url: publicMcp.mcpUrl ?? PUBLIC_MCP_PLACEHOLDER_URL,
      urlUnknown: publicMcp.enabled && publicMcp.mcpUrl === null, // D-6
      name: name.trim(),
      scopes: botScopes(ticked),
    });
  };

  return (
    <Modal title="Connect a bot" onClose={onClose}>
      {output ? (
        <div className={`${formStyles.content} text-sm`} data-component="connect-bot-dialog">
          <ConnectBotOutput platform={platform} result={output} onDone={onClose} />
        </div>
      ) : (
        <div className={formStyles.form} data-component="connect-bot-dialog">
          <div className={formStyles.field}>
            <span className={formStyles.label}>1. Platform</span>
            <div className="flex flex-wrap gap-3">
              {BOT_PLATFORMS.map((entry) => (
                <label key={entry.id} className={formStyles.choice}>
                  <input
                    type="radio"
                    name="connect-bot-platform"
                    checked={platform === entry.id}
                    onChange={() => handlePlatformChange(entry.id)}
                  />
                  <span className={formStyles.choiceTitle}>{entry.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={formStyles.field}>
            <span className={formStyles.label}>2. Reach</span>
            <div className="flex flex-wrap gap-3">
              {platformEntry.reaches.map((candidate) => (
                <label key={candidate} className={formStyles.choice}>
                  <input
                    type="radio"
                    name="connect-bot-reach"
                    checked={reach === candidate}
                    onChange={() => setReach(candidate)}
                  />
                  <span className={formStyles.choiceTitle}>{REACH_LABELS[candidate]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={formStyles.field}>
            <span className={formStyles.label}>3. Access</span>
            {platform === 'grok-bot' && reach === 'public' ? (
              <p className={formStyles.text}>
                You choose the access level when you approve the sign-in in this dashboard.
              </p>
            ) : (
              <div className="space-y-1.5">
                <label className={formStyles.choice}>
                  <input type="checkbox" checked disabled />
                  <span className={formStyles.choiceTitle}>{SCOPE_INFO['read:state'].label} (always on)</span>
                </label>
                {TICKABLE_SCOPES.map((scope) => (
                  <label key={scope} className={formStyles.choice}>
                    <input
                      type="checkbox"
                      checked={ticked.has(scope)}
                      onChange={(e) => toggleScope(scope, e.target.checked)}
                    />
                    <span className={formStyles.choiceTitle}>
                      {SCOPE_INFO[scope].label}
                      {SCOPE_INFO[scope].hint && <span className="text-muted-foreground">({SCOPE_INFO[scope].hint})</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className={formStyles.field}>
            <label htmlFor="connect-bot-name" className={formStyles.label}>Name</label>
            <input
              id="connect-bot-name"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              className={formStyles.input}
            />
          </div>

          {reach === 'public' ? (
            publicMcp?.enabled ? (
              <button
                type="button"
                onClick={handleShowSetup}
                className={`${formStyles.primaryButton} self-start`}
              >
                Show setup
              </button>
            ) : (
              <>
                <p className={formStyles.hint}>
                  Public MCP is off. Hosted bots need it: turn it on under Public MCP in Settings → Anywhere.
                </p>
                <button
                  type="button"
                  onClick={showPublicMcpSettings}
                  className={`${formStyles.button} self-start`}
                >
                  Show Public MCP settings
                </button>
              </>
            )
          ) : forbidden ? (
            <p className={formStyles.hint}>Only a browser on this machine can connect bots.</p>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!canSubmit}
              className={`${formStyles.primaryButton} self-start`}
            >
              {reach === 'connector' ? `Copy for ${platformEntry.label}` : 'Create token'}
            </button>
          )}
          {error && <p className={formStyles.error}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}
