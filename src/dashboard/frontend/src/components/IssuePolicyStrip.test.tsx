import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IssuePolicyStrip } from './IssuePolicyStrip';

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

describe('IssuePolicyStrip', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/review/')) return response({ override: { reviewMode: null, reReviewScope: null, reviewModel: null }, resolved: { reviewMode: 'full', reReviewScope: 'changed', reviewModel: 'gpt-5.5' } });
      if (url.includes('/staffing')) return response({ override: { workModel: 'gpt-5.5' }, resolved: { model: 'gpt-5.5', tiered: false, source: 'issue', recordedModel: 'claude-sonnet-5' } });
      if (url.includes('/swarm-policy')) return response({ configured: null, resolved: { mode: 'off', source: { mode: 'default' } } });
      if (url.includes('/available-models')) return response({ openai: [{ id: 'gpt-5.5', name: 'GPT 5.5' }] });
      if (url.includes('/restart-fresh')) return response({ success: true });
      return { ok: false, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it('renders all shared controls with resolved default labels', async () => {
    render(<IssuePolicyStrip issueId="PAN-2674" />);
    expect(await screen.findByLabelText('Review mode for this issue')).toBeInTheDocument();
    expect(screen.getByLabelText('Re-review scope for this issue')).toBeInTheDocument();
    expect(screen.getByLabelText('Review model for this issue')).toHaveTextContent('reviewers: default (gpt-5.5)');
    expect(screen.getByLabelText('Work model for this issue')).toHaveTextContent('work: default (gpt-5.5)');
    expect(screen.getByLabelText('Swarm mode for this issue')).toHaveTextContent('swarm: default (off)');
  });

  it('persists one per-issue model for the whole review convoy', async () => {
    render(<IssuePolicyStrip issueId="PAN-2674" />);
    const reviewers = await screen.findByLabelText('Review model for this issue');
    fireEvent.change(reviewers, { target: { value: 'gpt-5.5' } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/review/PAN-2674/config', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reviewModel: 'gpt-5.5' }),
    })));
  });

  it('persists a work-model selection and offers an explicit fresh restart', async () => {
    render(<IssuePolicyStrip issueId="PAN-2674" />);
    const work = await screen.findByLabelText('Work model for this issue');
    fireEvent.change(work, { target: { value: 'gpt-5.5' } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/issues/PAN-2674/staffing', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByRole('button', { name: 'Restart agent with new staffing' })).toBeInTheDocument();
  });
});
