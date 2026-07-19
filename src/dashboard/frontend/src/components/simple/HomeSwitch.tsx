/**
 * PAN-2908 · C-SIMPLE — home-tab switch: simple mode renders "My work" (or the
 * simple issue page when one is open); advanced renders the existing HomePage.
 */
import { useUiMode } from '../../lib/simple/uiMode';
import { SimpleHomePage } from './SimpleHomePage';
import { SimpleIssuePage } from './SimpleIssuePage';

interface HomeSwitchProps {
  advanced: React.ReactNode;
}

export function HomeSwitch({ advanced }: HomeSwitchProps) {
  const mode = useUiMode((s) => s.mode);
  const simpleIssueId = useUiMode((s) => s.simpleIssueId);
  if (mode === 'simple') {
    return simpleIssueId ? <SimpleIssuePage issueId={simpleIssueId} /> : <SimpleHomePage />;
  }
  return <>{advanced}</>;
}
