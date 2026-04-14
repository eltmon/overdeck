/**
 * Tests for UpgradeAnnouncement (PAN-705).
 *
 * Covers the three paths the reviewer flagged:
 *   (a) renders the migration table when the dismissed flag is unset
 *   (b) returns null when the dismissed flag is '1'
 *   (c) clicking the dismiss button writes '1' to localStorage AND
 *       removes the banner from the DOM on the next render
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpgradeAnnouncement } from './UpgradeAnnouncement';

const STORAGE_KEY = 'pan-upgrade-announcement-0.7.0-dismissed';

describe('UpgradeAnnouncement', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders the banner and migration table when localStorage key is not set', () => {
    render(<UpgradeAnnouncement />);

    // Header banner copy
    expect(
      screen.getByText(/Panopticon 0\.7\.0 — Command Taxonomy Reorganization/),
    ).toBeInTheDocument();

    // Migration table is rendered inside a <details> element. It exists in the
    // DOM even when the <details> is collapsed — which is all this test needs:
    // we're proving the component rendered the table, not whether it's visible.
    expect(screen.getByText(/Show full migration table/)).toBeInTheDocument();

    // Sample a few known table entries to prove the table contents actually
    // rendered (not just an empty shell).
    expect(screen.getByText('pan work issue <id>')).toBeInTheDocument();
    expect(screen.getByText('pan start <id>')).toBeInTheDocument();
    expect(screen.getByText('pan work done <id>')).toBeInTheDocument();
    expect(screen.getByText('pan done <id>')).toBeInTheDocument();

    // Dismiss button is present with the expected accessible name
    expect(
      screen.getByRole('button', { name: /dismiss upgrade announcement/i }),
    ).toBeInTheDocument();
  });

  it('returns null (renders nothing) when localStorage dismissed flag is "1"', () => {
    localStorage.setItem(STORAGE_KEY, '1');

    const { container } = render(<UpgradeAnnouncement />);

    // Entire component short-circuits to null — root is empty.
    expect(container.firstChild).toBeNull();

    // And the banner's identifying copy is NOT in the document.
    expect(
      screen.queryByText(/Panopticon 0\.7\.0 — Command Taxonomy Reorganization/),
    ).not.toBeInTheDocument();
  });

  it('clicking dismiss writes "1" to localStorage and unmounts the banner', () => {
    render(<UpgradeAnnouncement />);

    // Sanity check: the banner is visible at start
    expect(
      screen.getByText(/Panopticon 0\.7\.0 — Command Taxonomy Reorganization/),
    ).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Click the dismiss button
    fireEvent.click(
      screen.getByRole('button', { name: /dismiss upgrade announcement/i }),
    );

    // localStorage now persists the dismissed state
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');

    // And the banner is gone from the DOM — the internal `dismissed` state
    // transitioned to true, so the component's early return kicks in.
    expect(
      screen.queryByText(/Panopticon 0\.7\.0 — Command Taxonomy Reorganization/),
    ).not.toBeInTheDocument();
  });
});
