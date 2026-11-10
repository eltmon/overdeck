import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderManagementSection } from '../ProviderManagementSection';
import type { SettingsConfig } from '../../types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const formData = {
  models: {
    providers: { anthropic: true, grok: true },
    provider_harnesses: {},
    provider_default_harnesses: { grok: 'grok' },
  },
  api_keys: {},
  experimental: {},
} as unknown as SettingsConfig;

describe('ProviderManagementSection Grok Build row (PAN-5078)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the Grok sign-in badge and the grok login help', async () => {
    const user = userEvent.setup();
    render(
      <ProviderManagementSection
        claudeAuth={null}
        codexAuth={undefined}
        formData={formData}
        onHarnessModelPermutationsToggle={vi.fn()}
        onOpenRouterApiKeySaved={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Grok sign-in')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand Grok Build details' }));
    expect(screen.getByText(/Overdeck uses Grok Build’s saved sign-in/)).toBeInTheDocument();
    expect(screen.getByText('grok login')).toBeInTheDocument();
  });
});
