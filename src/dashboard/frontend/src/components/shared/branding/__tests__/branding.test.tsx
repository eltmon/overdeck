import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  HARNESS_BRANDS,
  HarnessLogo,
  PROVIDER_BRANDS,
  ProviderLogo,
} from '../index';

describe('shared branding registry', () => {
  it('defines every provider and harness brand with labels, colors, and icons', () => {
    expect(Object.keys(PROVIDER_BRANDS)).toEqual([
      'anthropic',
      'openai',
      'google',
      'minimax',
      'zai',
      'kimi',
      'mimo',
      'nous',
      'dashscope',
      'openrouter',
    ]);
    expect(Object.keys(HARNESS_BRANDS)).toEqual(['claude-code', 'codex', 'ohmypi', 'acp', 'kimi-code']);

    for (const brand of [...Object.values(PROVIDER_BRANDS), ...Object.values(HARNESS_BRANDS)]) {
      expect(brand.id).toBeTruthy();
      expect(brand.label).toBeTruthy();
      expect(brand.color).toMatch(/^#/);
      expect(brand.Icon).toBeTypeOf('function');
    }
  });

  it('renders harness logos with the expected provider marks and pi glyph tile', () => {
    const { rerender } = render(<HarnessLogo harness="claude-code" />);

    expect(screen.getByLabelText('Claude Code logo')).toHaveAttribute('viewBox', '0 0 256 257');

    rerender(<HarnessLogo harness="codex" />);
    expect(screen.getByLabelText('Codex logo')).toHaveAttribute('viewBox', '0 0 256 260');

    rerender(<HarnessLogo harness="ohmypi" />);
    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument();
    expect(screen.getByText('π')).toBeInTheDocument();

    rerender(<HarnessLogo harness="acp" />);
    expect(screen.getByLabelText('ACP logo')).toBeInTheDocument();
    expect(screen.getByText('ACP')).toBeInTheDocument();

    rerender(<HarnessLogo harness="kimi-code" />);
    expect(screen.getByLabelText('Kimi Code logo')).toBeInTheDocument();
  });

  it('renders every known provider as an inline SVG mark and falls back to a letter badge for unknown providers', () => {
    const { container, rerender } = render(<ProviderLogo provider="openai" />);

    for (const [provider, brand] of Object.entries(PROVIDER_BRANDS)) {
      rerender(<ProviderLogo provider={provider} />);
      const logo = screen.getByLabelText(`${brand.label} logo`);

      expect(logo.tagName.toLowerCase()).toBe('svg');
      expect(container.querySelector('text')).not.toBeInTheDocument();
    }

    rerender(<ProviderLogo provider="unknown-provider" label="Unknown Provider" />);
    expect(screen.getByText('U')).toBeInTheDocument();
  });
});
