/**
 * The System / Light / Dark radiogroup (PAN-5041, PAN-5208), shared by the phone app's Settings
 * screen and the `/m` settings sheet. The heading id comes from `useId()` so two instances on one
 * page never share a label.
 */
import { useId } from 'react';

import { APPEARANCES, type Appearance } from '../../lib/appearance';

const APPEARANCE_LABEL: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export interface AppearanceChoiceProps {
  value: Appearance;
  onChange(appearance: Appearance): void;
  /** One line under the choices: what System follows and where the setting is stored. */
  note: string;
}

export function AppearanceChoice({ value, onChange, note }: AppearanceChoiceProps) {
  const labelId = useId();
  return (
    <div data-component="appearance-setting" className="flex flex-col gap-2">
      <h3 id={labelId} className="text-sm font-medium text-foreground">
        Appearance
      </h3>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col">
        {APPEARANCES.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            onClick={() => onChange(a)}
            className="flex min-h-11 items-center justify-between gap-3 border-b border-border text-sm text-foreground"
          >
            <span>{APPEARANCE_LABEL[a]}</span>
            <span className="text-muted-foreground">{value === a ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
