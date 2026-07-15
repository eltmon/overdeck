import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionUpdateButton } from './VersionUpdateButton';

describe('VersionUpdateButton', () => {
  it('keeps the version visible and activates independently', () => {
    const onOpen = vi.fn(); render(<VersionUpdateButton currentVersion="1.2.3" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Overdeck version 1.2.3/ }));
    expect(screen.getByText('v1.2.3')).toBeTruthy(); expect(onOpen).toHaveBeenCalledOnce();
  });
  it('uses the exact visible and accessible tooltip copy', () => {
    render(<VersionUpdateButton currentVersion="1.2.3" onOpen={() => undefined} />);
    expect(screen.getByRole('tooltip').textContent).toBe('Click to update Overdeck to the latest version.');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Click to update Overdeck to the latest version.');
  });
  it('decorates actionable background state without replacing the version', () => {
    render(<VersionUpdateButton currentVersion="1.2.3" phase="available" onOpen={() => undefined} />);
    expect(screen.getByText('v1.2.3')).toBeTruthy(); expect(screen.getByLabelText('Update status: available')).toBeTruthy();
  });
});
