import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HOOK_INVENTORY, WIRED_HOOK_NAMES } from '@overdeck/contracts';
import type { HookStreamEntry } from './useConfluenceData';

const HOT_DURATION_MS = 420;
const WIRED_HOOKS = new Set<string>(WIRED_HOOK_NAMES);

interface HookBusProps {
  entries: readonly HookStreamEntry[];
}

function entryKey(entry: HookStreamEntry): number {
  return entry.sequence;
}

export function HookBus({ entries }: HookBusProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hotHooks, setHotHooks] = useState<ReadonlySet<string>>(new Set());
  const seenEntries = useRef<Set<number>>(new Set());
  const hotTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const nextSeen = new Set<number>();
    const increments = new Map<string, number>();
    for (const entry of entries) {
      const key = entryKey(entry);
      nextSeen.add(key);
      if (
        seenEntries.current.has(key)
        || entry.source !== 'hook'
        || !WIRED_HOOKS.has(entry.hookName)
      ) continue;
      increments.set(entry.hookName, (increments.get(entry.hookName) ?? 0) + 1);
    }
    seenEntries.current = nextSeen;
    if (increments.size === 0) return;

    setCounts((current) => {
      const next = { ...current };
      for (const [hookName, increment] of increments) {
        next[hookName] = (next[hookName] ?? 0) + increment;
      }
      return next;
    });
    setHotHooks((current) => {
      const next = new Set(current);
      for (const hookName of increments.keys()) next.add(hookName);
      return next;
    });

    for (const hookName of increments.keys()) {
      const existing = hotTimers.current.get(hookName);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        hotTimers.current.delete(hookName);
        setHotHooks((current) => {
          const next = new Set(current);
          next.delete(hookName);
          return next;
        });
      }, HOT_DURATION_MS);
      hotTimers.current.set(hookName, timer);
    }
  }, [entries]);

  useEffect(() => () => {
    for (const timer of hotTimers.current.values()) clearTimeout(timer);
    hotTimers.current.clear();
  }, []);

  return (
    <aside className="confluence-hookbus gv-glass" aria-label="Hook bus">
      <h3>HOOK BUS <em>· harness</em></h3>
      <div className="confluence-hook-scroll">
        {HOOK_INVENTORY.map((hook) => {
          const count = counts[hook.name] ?? 0;
          return (
            <div
              key={hook.name}
              data-hook-name={hook.name}
              data-wired={hook.wired ? 'true' : 'false'}
              className={`confluence-hook ${hook.wired ? 'wired' : 'unwired'} ${hotHooks.has(hook.name) ? 'hot' : ''}`}
              style={hook.wired ? { '--hook-color': hook.color } as CSSProperties : undefined}
            >
              <span className="led" />
              <span className="name">{hook.name}</span>
              <span className="count">{hook.wired ? count : '—'}</span>
            </div>
          );
        })}
      </div>
      <p>LEDs fire on live hook events. <b>Dotted</b> hooks are dark fiber awaiting a producer.</p>
    </aside>
  );
}
