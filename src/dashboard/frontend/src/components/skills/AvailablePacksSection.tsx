/**
 * Available packs (PAN-5540): known skill packs and pack groups not yet added,
 * on the global Skills page under Skill packs.
 *
 * A group row lists its missing members; a pack row shows its source and
 * disclosure. A pack the dashboard cannot add (it needs a ref, or adding it
 * builds code) shows the exact CLI command instead. The section is
 * supplementary: while loading, on error, or with nothing to show it renders
 * nothing.
 */
import { cn } from '../../lib/utils';
import {
  missingLabel,
  unknownMembersNote,
  useAvailablePacks,
  type AvailableGroup,
  type AvailablePack,
  type NotAddableReason,
} from './availablePacks';

const REASON_LABELS: Record<NotAddableReason, string> = {
  'needs-ref': 'Needs a ref. Add it from the CLI:',
  'runs-build': 'Adding it builds code on this machine. Add it from the CLI:',
};

const shortRef = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

function groupMatches(group: AvailableGroup, search: string): boolean {
  return group.name.toLowerCase().includes(search) || group.missing.some(id => id.toLowerCase().includes(search));
}

function packMatches(pack: AvailablePack, search: string): boolean {
  return pack.id.toLowerCase().includes(search) || (pack.disclosure ?? '').toLowerCase().includes(search);
}

export function AvailablePacksSection({ search = '' }: { search?: string }) {
  const { data } = useAvailablePacks();
  if (!data) return null;
  const query = search.toLowerCase();
  const groups = data.groups.filter(group => group.missing.length > 0 && (!query || groupMatches(group, query)));
  const packs = data.packs.filter(pack => !pack.added && (!query || packMatches(pack, query)));
  if (groups.length === 0 && packs.length === 0) return null;

  return (
    <section aria-label="Available packs" data-testid="available-packs" className="space-y-2 pt-2">
      <div>
        <h3 className="text-[13px] font-medium text-foreground">Available packs</h3>
        <p className="max-w-[72ch] text-xs leading-5 text-muted-foreground">
          Known packs you have not added. Adding trusts a pinned commit and turns nothing on.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {groups.map((group, index) => (
          <div
            key={`group:${group.name}`}
            data-available-group={group.name}
            className={cn('space-y-0.5 px-3 py-2 text-xs leading-5', index > 0 && 'border-t border-border')}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono-ui text-[13px] text-foreground">{group.name}</span>
              <span className="text-muted-foreground">group · {missingLabel(group)}</span>
            </div>
            <p className="font-mono text-muted-foreground">{group.missing.join(', ')}</p>
            {group.unknown.length > 0 && <p className="text-body-foreground">{unknownMembersNote(group.unknown)}</p>}
            <code className="block font-mono text-foreground">{group.addCommand}</code>
          </div>
        ))}
        {packs.map((pack, index) => (
          <div
            key={`pack:${pack.id}`}
            data-available-pack={pack.id}
            className={cn('space-y-0.5 px-3 py-2 text-xs leading-5', (groups.length > 0 || index > 0) && 'border-t border-border')}
          >
            <span className="font-mono-ui text-[13px] text-foreground">{pack.id}</span>
            {pack.disclosure && <p className="max-w-[96ch] text-body-foreground">{pack.disclosure}</p>}
            {pack.url && (
              <p className="truncate font-mono text-muted-foreground" title={pack.url}>
                {pack.url}
                {pack.ref ? ` @ ${shortRef(pack.ref)}` : ''}
              </p>
            )}
            {pack.reason && <p className="text-muted-foreground">{REASON_LABELS[pack.reason]}</p>}
            <code className="block font-mono text-foreground">{pack.addCommand}</code>
          </div>
        ))}
      </div>
    </section>
  );
}
