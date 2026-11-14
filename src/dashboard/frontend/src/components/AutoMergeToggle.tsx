/**
 * AutoMergeToggle — the issue's auto-merge routing key (PAN-1691 / PAN-1692).
 *
 * One shared control, several render sites (merge-train rows, issue header,
 * pipeline row, merge-policy roster).
 *
 * The per-issue override is the issue's `auto-merge` / `hold-for-uat` tracker
 * label, then the project default, then the global `require_uat_before_merge`
 * (PAN-3917 D3). The effective key is read from GET /api/merge-train/auto-merge.
 *
 * PAN-4753 WI-10: the toggle is editable. Auto and Hold are buttons; clicking
 * one writes its label through `POST /api/merge-train/policy/:issueId`
 * (WI-8), and clicking the pressed button when it is the label value clears
 * the label (`default`, follow the project). The update is optimistic and
 * reverts on error. A 404 (the route is not deployed) or 501 (the tracker
 * cannot carry labels), or `writable={false}`, renders the read-only
 * indicator instead. The badge variant is one button that flips Auto ↔ Hold.
 */
import { useEffect, useState } from 'react';
import { Zap, Lock } from 'lucide-react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import type { MergeTrainBoard } from './merge-train/train/boardTypes';
import { POLICY_DEFAULT_MARKER, POLICY_READ_ONLY_TITLE } from './merge-train/train/trainCopy';

const AUTO_MERGE_POLICY_KEY = ['merge-train', 'auto-merge-policy'];
const BOARD_KEY = ['merge-train', 'board'];

/** Where the value comes from, for the read-only indicator. */
const AUTO_MERGE_SOURCE =
  'Read-only. Set by the issue\'s auto-merge or hold-for-uat tracker label, else the project\'s auto-merge default, else the global require-UAT-before-merge setting.';

const EDITABLE_SOURCE =
  'Click Auto or Hold to set the issue\'s auto-merge or hold-for-uat tracker label; click the pressed one to follow the project default again.';

export type MergePolicy = 'auto' | 'hold';
export type MergePolicyWrite = MergePolicy | 'default';

/** Effective routing key per in-flight issue, shared across every mounted indicator. */
export function useAutoMergePolicyMap(): Record<string, boolean> {
  const { data } = useQuery({
    queryKey: AUTO_MERGE_POLICY_KEY,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const res = await fetch('/api/merge-train/auto-merge');
      if (!res.ok) return {};
      const json = (await res.json()) as { issues?: Array<{ issueId: string; autoMerge: boolean }> };
      return Object.fromEntries(
        (json.issues ?? []).map((entry) => [entry.issueId.toUpperCase(), entry.autoMerge]),
      );
    },
    staleTime: 15_000,
  });
  return data ?? {};
}

export function useAutoMergePolicy(issueId: string): boolean | undefined {
  return useAutoMergePolicyMap()[issueId.toUpperCase()];
}

/** What a click writes: the pressed label value clears to default, anything else sets that value. */
export function nextPolicyWrite(input: {
  clicked: MergePolicy;
  /** The label value; null = no label; undefined = the caller does not know. */
  label: MergePolicy | null | undefined;
  pressed: boolean;
}): MergePolicyWrite {
  if (input.label === undefined) return input.pressed ? 'default' : input.clicked;
  return input.label === input.clicked ? 'default' : input.clicked;
}

export interface AutoMergeToggleProps {
  issueId: string;
  /** 'segmented' = Auto/Hold pair; 'badge' = single chip (pipeline rows). */
  variant?: 'segmented' | 'badge';
  /** Compact reduces padding/icon size for dense rows. */
  compact?: boolean;
  className?: string;
  /** The issue's label policy when the caller knows it (null = no label, following the project). */
  policy?: MergePolicy | null;
  /** The effective policy when the caller knows it; otherwise read from the shared policy map. */
  effectivePolicy?: MergePolicy;
  /** False renders the read-only indicator (the tracker cannot carry the labels). */
  writable?: boolean;
}

type Snapshot = Array<[QueryKey, unknown]>;

export function AutoMergeToggle({
  issueId,
  variant = 'segmented',
  compact = false,
  className = '',
  policy,
  effectivePolicy,
  writable = true,
}: AutoMergeToggleProps) {
  const queryClient = useQueryClient();
  const mapValue = useAutoMergePolicy(issueId);
  const [label, setLabel] = useState<MergePolicy | null | undefined>(policy);
  const [localEffective, setLocalEffective] = useState<boolean | undefined>(undefined);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => { setLabel(policy); }, [policy]);
  useEffect(() => { setLocalEffective(undefined); }, [effectivePolicy, mapValue]);

  const autoMerge = localEffective
    ?? (effectivePolicy !== undefined ? effectivePolicy === 'auto' : mapValue);
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const lead = autoMerge === undefined
    ? 'Not routed yet — the issue has no open pull request.'
    : autoMerge
      ? 'Auto-merge — the train ships this when it is green.'
      : 'Hold for UAT — waits for a human batch review.';
  const readOnly = !writable || unsupported;
  const title = readOnly
    ? `${lead} ${POLICY_READ_ONLY_TITLE}. ${AUTO_MERGE_SOURCE}`
    : error
      ? `${lead} ${error}`
      : `${lead} ${EDITABLE_SOURCE}`;

  const write = async (next: MergePolicyWrite) => {
    if (pending) return;
    const id = issueId.toUpperCase();
    const mapSnapshot = queryClient.getQueryData<Record<string, boolean>>(AUTO_MERGE_POLICY_KEY);
    const boardSnapshot: Snapshot = queryClient.getQueriesData({ queryKey: BOARD_KEY });
    const previousLabel = label;
    const previousEffective = localEffective;

    // Optimistic: the label, the shared effective map, and every board query.
    setLabel(next === 'default' ? null : next);
    if (next !== 'default') {
      setLocalEffective(next === 'auto');
      queryClient.setQueryData<Record<string, boolean>>(AUTO_MERGE_POLICY_KEY, (old) => ({ ...(old ?? {}), [id]: next === 'auto' }));
    }
    queryClient.setQueriesData<MergeTrainBoard>({ queryKey: BOARD_KEY }, (old) => old && {
      ...old,
      projects: old.projects.map((project) => ({
        ...project,
        cars: project.cars.map((car) => car.issueId.toUpperCase() !== id ? car : {
          ...car,
          policy: next === 'default' ? null : next,
          ...(next === 'default' ? {} : { effectivePolicy: next }),
        }),
      })),
    });

    const revert = () => {
      setLabel(previousLabel);
      setLocalEffective(previousEffective);
      queryClient.setQueryData(AUTO_MERGE_POLICY_KEY, mapSnapshot);
      for (const [key, data] of boardSnapshot) queryClient.setQueryData(key, data);
    };

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/merge-train/policy/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ policy: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; effectivePolicy?: MergePolicy };
      if (res.status === 404 || res.status === 501) {
        revert();
        setUnsupported(true);
        return;
      }
      if (!res.ok) {
        revert();
        setError(body.error ?? `Could not change the merge policy (HTTP ${res.status})`);
        return;
      }
      if (body.effectivePolicy === 'auto' || body.effectivePolicy === 'hold') {
        setLocalEffective(body.effectivePolicy === 'auto');
      }
      void queryClient.invalidateQueries({ queryKey: AUTO_MERGE_POLICY_KEY });
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    } catch (err) {
      revert();
      setError(err instanceof Error ? err.message : 'Could not change the merge policy');
    } finally {
      setPending(false);
    }
  };

  if (variant === 'badge') {
    const tone = autoMerge === true
      ? 'text-primary bg-primary/[0.08] border-primary/[0.32]'
      : autoMerge === false
        ? 'text-warning-foreground bg-warning/[0.08] border-warning/[0.32]'
        : 'text-muted-foreground bg-transparent border-border';
    const content = (
      <>
        {autoMerge ? <Zap className={iconSize} /> : <Lock className={iconSize} />}
        {autoMerge === true ? 'auto' : autoMerge === false ? 'hold' : 'default'}
      </>
    );
    const badgeClass = `inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tone} ${className}`;
    if (readOnly) {
      return <span data-testid="auto-merge-badge" title={title} className={badgeClass}>{content}</span>;
    }
    return (
      <button
        type="button"
        data-testid="auto-merge-badge"
        title={title}
        disabled={pending}
        onClick={(event) => { event.stopPropagation(); void write(autoMerge === true ? 'hold' : 'auto'); }}
        className={`${badgeClass} hover:brightness-110 disabled:opacity-60`}
      >
        {content}
      </button>
    );
  }

  const seg = (active: boolean, tone: string) =>
    `inline-flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} text-xs font-medium ` +
    (active ? tone : 'text-muted-foreground');
  const autoTone = 'text-primary bg-primary/[0.08]';
  const holdTone = 'text-warning-foreground bg-warning/[0.08]';
  const marker = (pressed: boolean) => pressed && label === null
    ? <span className="text-[11px] font-normal opacity-75">{POLICY_DEFAULT_MARKER}</span>
    : null;

  if (readOnly) {
    return (
      <div
        role="group"
        aria-label="Auto-merge policy"
        title={title}
        className={`inline-flex overflow-hidden rounded-lg border border-border bg-background ${className}`}
      >
        <span aria-pressed={autoMerge === true} className={seg(autoMerge === true, autoTone)}>
          <Zap className={iconSize} /> Auto
        </span>
        <span aria-pressed={autoMerge === false} className={`border-l border-border ${seg(autoMerge === false, holdTone)}`}>
          <Lock className={iconSize} /> Hold
        </span>
      </div>
    );
  }

  const click = (clicked: MergePolicy) => (event: React.MouseEvent) => {
    event.stopPropagation();
    const pressed = clicked === 'auto' ? autoMerge === true : autoMerge === false;
    void write(nextPolicyWrite({ clicked, label, pressed }));
  };

  return (
    <div
      role="group"
      aria-label="Auto-merge policy"
      title={title}
      className={`inline-flex overflow-hidden rounded-lg border border-border bg-background ${className}`}
    >
      <button
        type="button"
        aria-pressed={autoMerge === true}
        disabled={pending}
        onClick={click('auto')}
        className={`${seg(autoMerge === true, autoTone)} hover:bg-accent disabled:opacity-60`}
      >
        <Zap className={iconSize} /> Auto {marker(autoMerge === true)}
      </button>
      <button
        type="button"
        aria-pressed={autoMerge === false}
        disabled={pending}
        onClick={click('hold')}
        className={`border-l border-border ${seg(autoMerge === false, holdTone)} hover:bg-accent disabled:opacity-60`}
      >
        <Lock className={iconSize} /> Hold {marker(autoMerge === false)}
      </button>
    </div>
  );
}
