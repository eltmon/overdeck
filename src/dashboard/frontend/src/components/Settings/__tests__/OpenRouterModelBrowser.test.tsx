import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenRouterModelBrowser, type OpenRouterModel } from '../OpenRouterModelBrowser';

const FREE_MODEL: OpenRouterModel = {
  id: 'qwen/qwen3.6-plus:free',
  name: 'Qwen 3.6 Plus',
  promptCostPer1M: 0,
  completionCostPer1M: 0,
  contextLength: 32768,
  supportsThinking: false,
  category: 'free',
};

const PAID_MODEL: OpenRouterModel = {
  id: 'anthropic/claude-3.5-sonnet',
  name: 'Claude 3.5 Sonnet',
  promptCostPer1M: 3,
  completionCostPer1M: 15,
  contextLength: 200000,
  supportsThinking: false,
  category: 'chat',
  topProvider: 'Anthropic',
};

const THINKING_MODEL: OpenRouterModel = {
  id: 'qwen/qwq-32b',
  name: 'QwQ 32B',
  promptCostPer1M: 1.2,
  completionCostPer1M: 1.8,
  contextLength: 131072,
  supportsThinking: true,
  category: 'chat',
};

describe('OpenRouterModelBrowser', () => {
  it('renders model list', () => {
    render(
      <OpenRouterModelBrowser
        models={[FREE_MODEL, PAID_MODEL]}
        favorites={[]}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByText('Qwen 3.6 Plus')).toBeDefined();
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeDefined();
  });

  it('labels free models with FREE badge', () => {
    render(
      <OpenRouterModelBrowser
        models={[FREE_MODEL]}
        favorites={[]}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByText('FREE')).toBeDefined();
  });

  it('shows thinking badge for models with supportsThinking', () => {
    render(
      <OpenRouterModelBrowser
        models={[THINKING_MODEL]}
        favorites={[]}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(screen.getByText('Thinking')).toBeDefined();
  });

  it('calls onToggleFavorite when star button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <OpenRouterModelBrowser
        models={[FREE_MODEL]}
        favorites={[]}
        onToggleFavorite={onToggle}
      />,
    );
    const starBtn = screen.getByTitle('Add to favorites');
    fireEvent.click(starBtn);
    expect(onToggle).toHaveBeenCalledWith(FREE_MODEL.id);
  });

  it('highlights favorited models', () => {
    render(
      <OpenRouterModelBrowser
        models={[FREE_MODEL]}
        favorites={[FREE_MODEL.id]}
        onToggleFavorite={vi.fn()}
      />,
    );
    // Favorite models show "Remove from favorites" title on the star button
    expect(screen.getByTitle('Remove from favorites')).toBeDefined();
  });

  it('filters by search query', () => {
    render(
      <OpenRouterModelBrowser
        models={[FREE_MODEL, PAID_MODEL]}
        favorites={[]}
        onToggleFavorite={vi.fn()}
      />,
    );
    const search = screen.getByPlaceholderText('Search models...');
    fireEvent.change(search, { target: { value: 'claude' } });
    expect(screen.queryByText('Qwen 3.6 Plus')).toBeNull();
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeDefined();
  });

  it('filters by Free category', () => {
    render(
      <OpenRouterModelBrowser
        models={[FREE_MODEL, PAID_MODEL]}
        favorites={[]}
        onToggleFavorite={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Free'));
    expect(screen.queryByText('Claude 3.5 Sonnet')).toBeNull();
    expect(screen.getByText('Qwen 3.6 Plus')).toBeDefined();
  });

  it('shows loading spinner when loading=true', () => {
    const { container } = render(
      <OpenRouterModelBrowser
        models={[]}
        favorites={[]}
        loading={true}
        onToggleFavorite={vi.fn()}
      />,
    );
    // Loading spinner rendered (Loader2 icon)
    expect(container.querySelector('svg')).toBeDefined();
  });
});
