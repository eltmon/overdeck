import { SettingsSection } from '../primitives/SettingsSection';
import { DevicesPanel } from '../anywhere/DevicesPanel';

/** Settings → Anywhere: reach this machine from other devices (PAN-4445 FR-8). */
export function AnywhereSection() {
  return (
    <SettingsSection id="anywhere" title="Anywhere" description="Reach this machine from your other devices">
      <DevicesPanel />
    </SettingsSection>
  );
}
