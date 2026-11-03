/**
 * The machine-wide switches of Settings → Anywhere → Machines (PAN-4650 D-4,
 * PAN-4651 D-4651-13): Share my conversations, and Combine matching
 * repositories across machines. Both live in `anywhere.json` on this machine.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Toggle } from '../Shared/Toggle';
import { apiError, type ApiResult, isOk } from './anywhereApi';
import { FLEET_PROJECTS_QUERY_KEY, setCombineRepositories, setShareConversations } from './machinesApi';

function SwitchRow({ testId, title, hint, checked, onChange }: { testId: string; title: string; hint: string; checked: boolean; onChange: (next: boolean) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const change = async (next: boolean) => {
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-start justify-between gap-4 px-4 mb-3" data-testid={testId}>
      <div className="min-w-0">
        <p className="text-[13px] text-foreground">{title}</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={(next) => void change(next)} disabled={saving} />
    </div>
  );
}

export function SharingSwitches({ self, onChanged }: { self: { shareConversations: boolean; combineRepositories?: boolean }; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const save = (label: string, action: () => Promise<ApiResult<unknown>>) => async () => {
    const result = await action();
    if (!isOk(result)) toast.error(`Could not change ${label}: ${apiError(result)}`);
    await Promise.all([onChanged(), queryClient.invalidateQueries({ queryKey: FLEET_PROJECTS_QUERY_KEY })]);
  };
  return (
    <>
      <SwitchRow
        testId="share-conversations"
        title="Share my conversations"
        hint="Linked machines list this machine's conversations. Turn off to hide them on the next sync."
        checked={self.shareConversations}
        onChange={(next) => save('sharing', () => setShareConversations(next))()}
      />
      <SwitchRow
        testId="combine-repositories"
        title="Combine matching repositories across machines"
        hint="One project per repository: conversations from other machines join the local project with the same git origin, and repositories only other machines have are listed under On other machines."
        checked={self.combineRepositories ?? true}
        onChange={(next) => save('combining', () => setCombineRepositories(next))()}
      />
    </>
  );
}
