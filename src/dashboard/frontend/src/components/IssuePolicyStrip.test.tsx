import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IssuePolicyStrip } from './IssuePolicyStrip';

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

const defaults = {
  review: { override: { reviewMode: null, reReviewScope: null, reviewModel: null }, resolved: { reviewMode: 'full', reReviewScope: 'changed', reviewModel: null } },
  staffing: {
    override: { workModel: null },
    tieredExecution: { effective: true, source: 'global', override: null },
    resolved: { model: 'gpt-5.5', tiered: true, source: 'default', recordedModel: 'gpt-5.5' },
  },
  swarm: { configured: null, resolved: { mode: 'off', source: { mode: 'default' } } },
};

describe('IssuePolicyStrip', () => {
  let fixtures = structuredClone(defaults);

  beforeEach(() => {
    fixtures = structuredClone(defaults);
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/review/')) return response(fixtures.review);
      if (url.includes('/staffing')) return response(fixtures.staffing);
      if (url.includes('/swarm-policy')) return response(fixtures.swarm);
      if (url.includes('/available-models')) return response({
        anthropic: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }],
        openai: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
      });
      if (url.includes('/restart-fresh')) return response({ success: true });
      return { ok: false, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it('renders one quiet Policies button when every policy uses its default', async () => {
    render(<IssuePolicyStrip issueId="PAN-2681" />);

    const strip = await screen.findByTestId('issue-policy-strip');
    expect(within(strip).getAllByRole('button')).toHaveLength(1);
    expect(within(strip).getByText('Policies')).toBeInTheDocument();
    expect(strip).not.toHaveTextContent(/default \(/i);
  });

  it('opens and dismisses the grouped portal panel', async () => {
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));

    expect(screen.getByLabelText('Issue policy overrides')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByLabelText('Review mode for this issue')).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Issue policy overrides')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue policies' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Issue policies' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText('Issue policy overrides')).not.toBeInTheDocument();
  });

  it('persists enum and model changes with the existing endpoints and payloads', async () => {
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));

    fireEvent.click(within(screen.getByLabelText('Review mode for this issue')).getByRole('button', { name: 'Quick' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/review/PAN-2681/config', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reviewMode: 'quick' }),
    })));

    fireEvent.change(screen.getByLabelText('Review model for this issue'), { target: { value: 'gpt-5.5' } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/review/PAN-2681/config', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reviewModel: 'gpt-5.5' }),
    })));

    fireEvent.change(screen.getByLabelText('Work model for this issue'), { target: { value: 'claude-sonnet-5' } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/issues/PAN-2681/staffing', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ workModel: 'claude-sonnet-5' }),
    })));

    fireEvent.click(within(screen.getByLabelText('Swarm mode for this issue')).getByRole('button', { name: 'Always' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/issues/PAN-2681/swarm-policy', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ value: { mode: 'always' } }),
    })));
  });

  it('uses the effective review mode to decide whether re-review is available', async () => {
    fixtures.review.override.reviewMode = 'quick';
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));
    expect(screen.queryByLabelText('Re-review scope for this issue')).not.toBeInTheDocument();
  });

  it('keeps the tiered Work Model default until PAN-2684 lands', async () => {
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));

    expect(screen.getByLabelText('Work model for this issue')).toHaveDisplayValue('Default · tiered');
  });

  it.each([
    ['issue-override', 'on (issue)'],
    ['plan-metadata', 'on (plan)'],
    ['global', 'on (global)'],
  ] as const)('renders the Standing crew default from the %s source', async (source, label) => {
    fixtures.staffing.tieredExecution.source = source;
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));

    expect(within(screen.getByLabelText('Standing crew routing for this issue')).getByRole('button', { name: `Default · ${label}` })).toBeInTheDocument();
  });

  it('writes and displays a Standing crew override only when explicitly configured', async () => {
    fixtures.staffing.tieredExecution.override = 'on';
    render(<IssuePolicyStrip issueId="PAN-2681" />);

    const strip = await screen.findByTestId('issue-policy-strip');
    expect(within(strip).getByRole('button', { name: /crew · on/i })).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Issue policies' }));
    fireEvent.click(within(screen.getByLabelText('Standing crew routing for this issue')).getByRole('button', { name: 'Off' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/PAN-2681/tiered-execution', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ override: 'off' }),
    })));
  });

  it('clears the Standing crew override from the row and Reset all', async () => {
    fixtures.staffing.tieredExecution.override = 'off';
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reset standing crew to default' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/PAN-2681/tiered-execution', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ override: null }),
    })));

    vi.mocked(global.fetch).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/PAN-2681/tiered-execution', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ override: null }),
    })));
  });

  it('explains when a work-model override replaces crew routing', async () => {
    fixtures.staffing.override.workModel = 'gpt-5.5';
    render(<IssuePolicyStrip issueId="PAN-2681" />);

    const strip = await screen.findByTestId('issue-policy-strip');
    expect(within(strip).getByRole('button', { name: /work · GPT 5.5 · replaces crews/i })).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Issue policies' }));
    expect(screen.getByText('Overrides crew routing — every item on this issue runs this model.')).toBeInTheDocument();
  });

  it('does not show crew-suspension copy without a work-model override', async () => {
    render(<IssuePolicyStrip issueId="PAN-2681" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue policies' }));

    expect(screen.queryByText('Overrides crew routing — every item on this issue runs this model.')).not.toBeInTheDocument();
    expect(screen.queryByText(/replaces crews/i)).not.toBeInTheDocument();
  });

  it('keeps the plain work-model chip when crew routing is disabled', async () => {
    fixtures.staffing.override.workModel = 'gpt-5.5';
    fixtures.staffing.tieredExecution.effective = false;
    render(<IssuePolicyStrip issueId="PAN-2681" />);

    const strip = await screen.findByTestId('issue-policy-strip');
    expect(within(strip).getByRole('button', { name: /work · GPT 5.5$/i })).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Issue policies' }));
    expect(screen.queryByText('Overrides crew routing — every item on this issue runs this model.')).not.toBeInTheDocument();
  });

  it('preserves every affordance from the five-select policy strip', async () => {
    fixtures.review.override = { reviewMode: 'full', reReviewScope: 'all', reviewModel: 'gpt-5.5' };
    fixtures.staffing.override.workModel = 'claude-sonnet-5';
    fixtures.staffing.resolved.recordedModel = 'gpt-5.5';
    fixtures.swarm.configured = { mode: 'always' };
    fixtures.staffing.tieredExecution.override = 'on';

    render(<IssuePolicyStrip issueId="PAN-2681" />);
    const strip = await screen.findByTestId('issue-policy-strip');
    expect(within(strip).getByText('6')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: /review · full/i })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'restart pending' })).toBeInTheDocument();

    fireEvent.click(within(strip).getByRole('button', { name: 'Issue policies' }));
    const legacyControls = [
      'Review mode for this issue',
      'Re-review scope for this issue',
      'Review model for this issue',
      'Work model for this issue',
      'Swarm mode for this issue',
      'Standing crew routing for this issue',
    ];
    for (const ariaLabel of legacyControls) expect(screen.getByLabelText(ariaLabel)).toBeInTheDocument();

    for (const accessibleName of [
      'Reset review mode to default',
      'Reset re-review scope to default',
      'Reset review model to default',
      'Reset work model to default',
      'Reset swarm mode to default',
      'Reset standing crew to default',
    ]) expect(screen.getByRole('button', { name: accessibleName })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await waitFor(() => {
      const posts = vi.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(posts).toEqual(expect.arrayContaining([
        ['/api/review/PAN-2681/config', expect.objectContaining({ body: JSON.stringify({ reviewMode: null }) })],
        ['/api/review/PAN-2681/config', expect.objectContaining({ body: JSON.stringify({ reReviewScope: null }) })],
        ['/api/review/PAN-2681/config', expect.objectContaining({ body: JSON.stringify({ reviewModel: null }) })],
        ['/api/issues/PAN-2681/staffing', expect.objectContaining({ body: JSON.stringify({ workModel: null }) })],
        ['/api/issues/PAN-2681/swarm-policy', expect.objectContaining({ body: JSON.stringify({ value: null }) })],
      ]));
      expect(vi.mocked(global.fetch).mock.calls).toContainEqual([
        '/api/workspaces/PAN-2681/tiered-execution',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ override: null }) }),
      ]);
    });
    expect(screen.getByText('The work-model override applies to the next spawn; running agents are never restarted automatically.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart agent with new staffing' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restart agent with new staffing' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/agents/agent-pan-2681/restart-fresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ spawn: true, model: 'claude-sonnet-5' }),
    })));
    expect(await screen.findByText('Fresh restart requested.')).toBeInTheDocument();
  });
});
