import { describe, it, expect } from 'vitest';
import { buildPlanningPrompt, type PlanningIssue } from '../spawn-planning-session.js';

describe('buildPlanningPrompt', () => {
  const baseIssue: PlanningIssue = {
    id: '123',
    identifier: 'PAN-123',
    title: 'Test Issue',
    description: 'A test description',
    url: 'https://test.com/PAN-123',
    source: 'github',
  };

  it('renders a planning prompt without child stories', async () => {
    const prompt = await buildPlanningPrompt(baseIssue, '/tmp/workspace');
    expect(prompt).toContain('PAN-123');
    expect(prompt).toContain('Test Issue');
    expect(prompt).toContain('A test description');
    expect(prompt).not.toContain('Child Stories');
  });

  it('renders child stories section for Rally Features', async () => {
    const featureIssue: PlanningIssue = {
      ...baseIssue,
      source: 'rally',
      artifactType: 'PortfolioItem/Feature',
      childStories: [
        { ref: 'US100', title: 'Story A', status: 'In-Progress', description: 'Desc A' },
        { ref: 'US200', title: 'Story B', status: 'Defined', description: 'Desc B' },
      ],
    };

    const prompt = await buildPlanningPrompt(featureIssue, '/tmp/workspace');
    expect(prompt).toContain('Child Stories');
    expect(prompt).toContain('US100');
    expect(prompt).toContain('Story A');
    expect(prompt).toContain('US200');
    expect(prompt).toContain('Story B');
  });

  it('renders dependency-edge guidance when child stories exist', async () => {
    const featureIssue: PlanningIssue = {
      ...baseIssue,
      source: 'rally',
      artifactType: 'PortfolioItem/Feature',
      childStories: [
        { ref: 'US100', title: 'Story A', status: 'In-Progress', description: '' },
      ],
    };

    const prompt = await buildPlanningPrompt(featureIssue, '/tmp/workspace');
    expect(prompt).toContain('Cross-story dependencies');
    expect(prompt).toContain('blocks');
    expect(prompt).toContain('informs');
  });

  it('does not render child stories section for non-PortfolioItem issues', async () => {
    const storyIssue: PlanningIssue = {
      ...baseIssue,
      source: 'rally',
      artifactType: 'HierarchicalRequirement',
    };

    const prompt = await buildPlanningPrompt(storyIssue, '/tmp/workspace');
    expect(prompt).not.toContain('Child Stories');
  });
});
