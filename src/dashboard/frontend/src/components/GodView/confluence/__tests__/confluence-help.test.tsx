import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfluenceHelp } from '../ConfluenceHelp';

describe('Confluence field guide text (PAN-5131 FR-10)', () => {
  function guideText(): string {
    render(<ConfluenceHelp eventsPerMin={7} onClose={() => {}} />);
    return screen.getByRole('dialog', { name: 'Confluence field guide' }).textContent ?? '';
  }

  it('describes no behavior the canvas does not have', () => {
    const text = guideText();

    for (const phrase of [
      'merge-failed wrecks', 'floats it back to WORK', 'VERIFY', 'WIP', 'Mind Your Now', 'amber stuck',
    ]) expect(text).not.toContain(phrase);
  });

  it('describes the real rate, ages, labels, tide and landmarks', () => {
    const text = guideText();

    for (const phrase of [
      '60 seconds', 'stuck, unpushed work', 'API error', 'operator-gate', 'names no beneficiary',
      '8 idle minutes', 'only while it is running',
    ]) expect(text).toContain(phrase);
  });

  it('states the honesty contract with the live event count', () => {
    const text = guideText();

    expect(text).toContain('the current 60-second window contains 7 events');
    expect(text).toContain("The canvas never writes an orb's state, and no displayed age or rate is stored");
  });

  it('names the merge card for what a red ring means', () => {
    guideText();

    expect(screen.getByRole('heading', { name: 'Merge Portal & Red Rings' })).toBeInTheDocument();
  });
});
