import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlanningPrompt, writeFeatureContext, type PlanningIssue } from '../spawn-planning-session.js';
import { PAN_DIRNAME, PAN_CONTEXT_FILENAME } from '../../pan-dir/index.js';

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

  it('renders non-interactive auto-planning instructions', async () => {
    const prompt = await buildPlanningPrompt(baseIssue, '/tmp/workspace', undefined, undefined, true);

    expect(prompt).toContain('Auto Planning Mode');
    expect(prompt).toContain('Do not use AskUserQuestion');
    expect(prompt).toContain('plan.autoDecisions[]');
    expect(prompt).toContain('Halt only for a genuine contradiction');
  });
});

describe('writeFeatureContext', () => {
  const baseIssue: PlanningIssue = {
    id: '123',
    identifier: 'F123',
    title: 'Test Feature',
    description: 'A test feature description',
    url: 'https://rally.example.com/F123',
    source: 'rally',
    artifactType: 'PortfolioItem/Feature',
    childStories: [
      { ref: 'US100', title: 'Story A', status: 'In-Progress', description: 'Desc A' },
      { ref: 'US200', title: 'Story B', status: 'Defined', description: 'Desc B' },
    ],
  };

  it('writes FEATURE-CONTEXT.md for PortfolioItem issues', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pan-test-'));
    await writeFeatureContext(dir, baseIssue);
    const content = await readFile(join(dir, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8');
    expect(content).toContain('Feature Context: F123');
    expect(content).toContain('Test Feature');
    expect(content).toContain('https://rally.example.com/F123');
    expect(content).toContain('A test feature description');
    expect(content).toContain('US100');
    expect(content).toContain('Story A');
    expect(content).toContain('In-Progress');
    expect(content).toContain('Desc A');
    expect(content).toContain('US200');
    expect(content).toContain('Story B');
    expect(content).toContain('Defined');
    expect(content).toContain('Desc B');
    await rm(dir, { recursive: true });
  });

  it('writes placeholder for features with no child stories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pan-test-'));
    const issue = { ...baseIssue, childStories: [] };
    await writeFeatureContext(dir, issue);
    const content = await readFile(join(dir, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8');
    expect(content).toContain('_No child stories found._');
    await rm(dir, { recursive: true });
  });

  it('does nothing for non-PortfolioItem issues', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pan-test-'));
    const storyIssue: PlanningIssue = {
      ...baseIssue,
      artifactType: 'HierarchicalRequirement',
    };
    await writeFeatureContext(dir, storyIssue);
    // File should not exist
    await expect(readFile(join(dir, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8')).rejects.toThrow();
    await rm(dir, { recursive: true });
  });
});
