import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import VerbBadge, { type VerbBadgeVariant } from './VerbBadge';

const STATIC_VARIANTS = [
  'WORK RUNNING',
  'REVIEW RUNNING',
  'SHIP RUNNING',
  'PLANNING',
  'INPUT',
  'READY TO MERGE',
  'MERGED',
  'CHANGES REQUESTED',
  'QUEUED FOR PLAN',
] satisfies Exclude<VerbBadgeVariant, 'STUCK · Nh'>[];

const PULSING_VARIANTS = new Set<VerbBadgeVariant>([
  'WORK RUNNING',
  'REVIEW RUNNING',
  'SHIP RUNNING',
  'PLANNING',
  'INPUT',
]);

describe('VerbBadge', () => {
  it('renders a visual snapshot of all variants', () => {
    const { container } = render(
      <div>
        {STATIC_VARIANTS.map((variant) => (
          <VerbBadge key={variant} variant={variant} />
        ))}
        <VerbBadge variant="STUCK · Nh" hours={7} />
      </div>,
    );

    expect(container.firstChild).toMatchInlineSnapshot(`
      <div>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-info badge-border-info text-info-foreground"
          data-component="verb-badge"
          data-variant="WORK RUNNING"
        >
          <span
            aria-hidden="true"
            class="h-[6px] w-[6px] rounded-full bg-current verb-badge-pulse"
          />
          <span>
            WORK RUNNING
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-warning badge-border-warning text-warning-foreground"
          data-component="verb-badge"
          data-variant="REVIEW RUNNING"
        >
          <span
            aria-hidden="true"
            class="h-[6px] w-[6px] rounded-full bg-current verb-badge-pulse"
          />
          <span>
            REVIEW RUNNING
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-signal-review badge-border-signal-review text-signal-review-foreground"
          data-component="verb-badge"
          data-variant="SHIP RUNNING"
        >
          <span
            aria-hidden="true"
            class="h-[6px] w-[6px] rounded-full bg-current verb-badge-pulse"
          />
          <span>
            SHIP RUNNING
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-signal-review badge-border-signal-review text-signal-review-foreground"
          data-component="verb-badge"
          data-variant="PLANNING"
        >
          <span
            aria-hidden="true"
            class="h-[6px] w-[6px] rounded-full bg-current verb-badge-pulse"
          />
          <span>
            PLANNING
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-warning badge-border-warning text-warning-foreground"
          data-component="verb-badge"
          data-variant="INPUT"
        >
          <span
            aria-hidden="true"
            class="h-[6px] w-[6px] rounded-full bg-current verb-badge-pulse"
          />
          <span>
            INPUT
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-success badge-border-success text-success-foreground"
          data-component="verb-badge"
          data-variant="READY TO MERGE"
        >
          <span>
            READY TO MERGE
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-success badge-border-success text-success-foreground"
          data-component="verb-badge"
          data-variant="MERGED"
        >
          <span>
            MERGED
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-destructive badge-border-destructive text-destructive-foreground"
          data-component="verb-badge"
          data-variant="CHANGES REQUESTED"
        >
          <span>
            CHANGES REQUESTED
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] bg-transparent border-border text-muted-foreground"
          data-component="verb-badge"
          data-variant="QUEUED FOR PLAN"
        >
          <span>
            QUEUED FOR PLAN
          </span>
        </span>
        <span
          class="inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em] badge-bg-destructive badge-border-destructive text-destructive-foreground"
          data-component="verb-badge"
          data-variant="STUCK · Nh"
        >
          <span>
            STUCK · 7h
          </span>
        </span>
      </div>
    `);
  });

  it('adds data attributes and pulse only for active variants', () => {
    for (const variant of STATIC_VARIANTS) {
      const { container, unmount } = render(<VerbBadge variant={variant} />);
      const badge = screen.getByText(variant).closest('[data-component="verb-badge"]');

      expect(badge).toHaveAttribute('data-variant', variant);
      expect(container.querySelector('.verb-badge-pulse')).toBe(PULSING_VARIANTS.has(variant) ? badge?.firstChild : null);
      unmount();
    }
  });

  it('renders stuck hours without a pulse dot', () => {
    const { container } = render(<VerbBadge variant="STUCK · Nh" hours={12} />);

    expect(screen.getByText('STUCK · 12h')).toBeTruthy();
    expect(screen.getByText('STUCK · 12h').closest('[data-component="verb-badge"]')).toHaveAttribute('data-variant', 'STUCK · Nh');
    expect(container.querySelector('.verb-badge-pulse')).toBeNull();
  });
});
