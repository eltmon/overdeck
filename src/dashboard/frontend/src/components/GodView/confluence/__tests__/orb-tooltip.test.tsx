import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrbTooltip, resolveHoverOrb, tooltipPosition } from '../OrbTooltip';
import type { ConfluenceOrb } from '../useConfluenceData';

function orb(overrides: Partial<ConfluenceOrb> = {}): ConfluenceOrb {
  return {
    id: 'PAN-3447',
    project: 'overdeck',
    role: 'review',
    stage: 'REVIEW',
    title: 'God View Confluence',
    heat: 0.8,
    staleMin: 47,
    state: 'stale',
    convoy: [
      { agentId: 'security', role: 'security', model: 'claude-sonnet-5', status: 'running' },
      { agentId: 'synthesis', role: 'synthesis', model: 'claude-opus-5', status: 'running' },
    ],
    yieldReason: 'yield: review admission',
    yieldedByScheduler: true,
    warn: 'verification pending',
    broken: false,
    model: 'claude-opus-5',
    harness: 'claude-code',
    labels: ['frontend'],
    glyph: 'O',
    lastActivity: '2026-08-02T12:00:00.000Z',
    idleMin: 21,
    waitUntil: 0,
    thinkUntil: 0,
    compactT: 0,
    spend: 1.25,
    mergeStatus: null,
    ...overrides,
  };
}

describe('OrbTooltip', () => {
  it('keeps one hover session while an orbiting orb crosses the acquire boundary, then clears on mouseleave', () => {
    const moving = { x: 100, y: 100, radius: 10 };
    const competitor = { x: 136, y: 100, radius: 10 };
    let current: typeof moving | null = null;
    let sessions = 0;
    const move = (
      orbs: readonly (typeof moving)[],
      x: number,
      y: number,
      inside = true,
    ) => {
      const next = resolveHoverOrb(orbs, current, x, y, inside);
      if (!current && next) sessions += 1;
      current = next;
    };

    move([moving], 118, 100);
    expect(current).toBe(moving);

    moving.x = 110;
    move([moving, competitor], 136, 100);
    expect(current).toBe(moving);
    expect(sessions).toBe(1);

    move([moving, competitor], 136, 100, false);
    expect(current).toBeNull();
  });

  it('renders the union field set and flips left near the right canvas edge', () => {
    const anchor = { x: 780, y: 90, canvasWidth: 900 };
    render(<OrbTooltip orb={orb()} anchor={anchor} hookRate={17} eventsFired={42} />);

    const tooltip = screen.getByTestId('orb-tooltip');
    expect(tooltip).toHaveClass('flipped');
    expect(tooltip).toHaveStyle({ left: '464px', top: '106px' });
    for (const label of [
      'Model', 'Harness', 'Hook rate', 'Frost', 'Events fired', 'Stale age',
      'Yield reason', 'Warning', 'Convoy',
    ]) expect(screen.getByText(label)).toBeInTheDocument();
    for (const text of [
      'PAN-3447', 'God View Confluence', 'REVIEW', 'review', 'overdeck', 'stale',
      'claude-opus-5', 'claude-code', '17 ev/m', '42', '47m', 'yield: review admission',
      'verification pending', 'security · synthesis', 'click for issue rail →',
    ]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Frost/).parentElement).toHaveTextContent('50%');
    expect(tooltipPosition(anchor).flipped).toBe(true);
  });

  it('keeps pointer-events none in confluence.css and does not grow theme.css', () => {
    const root = process.cwd();
    const frontend = root.endsWith('/src/dashboard/frontend')
      ? root
      : resolve(root, 'src/dashboard/frontend');
    const confluenceCss = readFileSync(
      resolve(frontend, 'src/components/GodView/confluence/confluence.css'),
      'utf8',
    );
    const themeCss = readFileSync(
      resolve(frontend, 'src/components/GodView/theme.css'),
      'utf8',
    );
    expect(confluenceCss).toMatch(
      /\.confluence-tooltip\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(themeCss).not.toContain('.confluence-tooltip');
  });
});
