import { useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SKILL_OVERRIDES_QUERY_KEY } from './SkillOverridesPanel';

interface CachedSkillStates { skills?: Array<{ core: boolean; issue: boolean | null }> }

/**
 * PAN-5244: how many non-core skills this issue overrides, read from the
 * react-query cache only. Returns null until the Skills tab has loaded the
 * data. It creates no query and no observer, so it can never issue a request.
 */
export function useIssueSkillOverrideCount(issueId: string): number | null {
  const queryClient = useQueryClient();
  // Same key SkillOverridesPanel uses for level="issue".
  const queryKey = useMemo(() => [...SKILL_OVERRIDES_QUERY_KEY, 'issue', null, issueId], [issueId]);
  const data = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => queryClient.getQueryData<CachedSkillStates>(queryKey),
  );
  if (!data?.skills) return null;
  // The panel's own `counts.here` rule at issue level.
  return data.skills.filter((skill) => !skill.core && skill.issue !== null).length;
}
