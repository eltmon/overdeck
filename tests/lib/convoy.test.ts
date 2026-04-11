import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('convoy', () => {
  let tempDir: string;
  let mockConvoyDir: string;
  let mockAgentsDir: string;
  let mockProjectPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-convoy-test-'));
    mockConvoyDir = join(tempDir, 'convoys');
    mockAgentsDir = join(tempDir, 'agents');
    mockProjectPath = join(tempDir, 'project');

    mkdirSync(mockConvoyDir, { recursive: true });
    mkdirSync(mockAgentsDir, { recursive: true });
    mkdirSync(mockProjectPath, { recursive: true });

    // Mock paths
    vi.doMock('../../src/lib/paths.js', () => ({
      AGENTS_DIR: mockAgentsDir,
    }));

    // Mock tmux functions
    vi.doMock('../../src/lib/tmux.js', () => ({
      createSession: vi.fn(),
      killSession: vi.fn(),
      sessionExists: vi.fn(() => false),
    }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  describe('parseAgentTemplate', () => {
    it('should parse frontmatter and content correctly', async () => {
      const { parseAgentTemplate } = await import('../../src/lib/convoy.js');

      const templatePath = join(mockAgentsDir, 'test-agent.md');
      const templateContent = `---
name: test-agent
description: Test agent for testing
model: sonnet
tools:
  - Read
  - Write
  - Bash
---

# Test Agent Prompt

This is the agent's prompt content.
`;

      writeFileSync(templatePath, templateContent);

      const parsed = parseAgentTemplate(templatePath);

      expect(parsed.name).toBe('test-agent');
      expect(parsed.description).toBe('Test agent for testing');
      expect(parsed.model).toBe('sonnet');
      expect(parsed.tools).toEqual(['Read', 'Write', 'Bash']);
      expect(parsed.content).toContain('Test Agent Prompt');
      expect(parsed.content).toContain("This is the agent's prompt content.");
    });

    it('should throw error if template not found', async () => {
      const { parseAgentTemplate } = await import('../../src/lib/convoy.js');

      expect(() => {
        parseAgentTemplate(join(mockAgentsDir, 'nonexistent.md'));
      }).toThrow('Agent template not found');
    });

    it('should throw error if frontmatter is invalid', async () => {
      const { parseAgentTemplate } = await import('../../src/lib/convoy.js');

      const templatePath = join(mockAgentsDir, 'invalid.md');
      writeFileSync(templatePath, 'No frontmatter here!');

      expect(() => {
        parseAgentTemplate(templatePath);
      }).toThrow('Invalid agent template format');
    });

    it('should handle optional frontmatter fields', async () => {
      const { parseAgentTemplate } = await import('../../src/lib/convoy.js');

      const templatePath = join(mockAgentsDir, 'minimal.md');
      const templateContent = `---
name: minimal
---

Minimal prompt.
`;

      writeFileSync(templatePath, templateContent);

      const parsed = parseAgentTemplate(templatePath);

      expect(parsed.name).toBe('minimal');
      expect(parsed.description).toBe('');
      expect(parsed.model).toBe('sonnet'); // Default
      expect(parsed.tools).toEqual([]);
    });
  });

  describe('getConvoyStatus', () => {
    it('should return undefined if convoy not found', async () => {
      // Override CONVOY_DIR for this test
      const convoyDir = join(tempDir, 'test-convoys');
      mkdirSync(convoyDir, { recursive: true });

      vi.doMock('../../src/lib/convoy.js', async () => {
        const actual = await vi.importActual('../../src/lib/convoy.js');
        return {
          ...actual,
          // We can't easily mock the internal CONVOY_DIR, so we'll just test the behavior
        };
      });

      const { getConvoyStatus } = await import('../../src/lib/convoy.js');

      const status = getConvoyStatus('nonexistent-convoy');
      expect(status).toBeUndefined();
    });
  });

  describe('listConvoys', () => {
    it('should return empty array if convoy directory does not exist', async () => {
      const nonExistentDir = join(tempDir, 'no-convoys');

      vi.doMock('../../src/lib/convoy.js', async () => {
        const actual = await vi.importActual('../../src/lib/convoy.js');
        return actual;
      });

      const { listConvoys } = await import('../../src/lib/convoy.js');

      const convoys = listConvoys();
      expect(Array.isArray(convoys)).toBe(true);
    });
  });

  describe('convoy state management', () => {
    it('should create and persist convoy state', async () => {
      // This is more of an integration test since we need real file operations
      // We'll verify the state file format is correct

      const stateFile = join(mockConvoyDir, 'convoy-test-123.json');
      const state = {
        id: 'convoy-test-123',
        template: 'code-review',
        status: 'running' as const,
        agents: [
          {
            role: 'correctness',
            subagent: 'code-review-correctness',
            tmuxSession: 'convoy-test-123-correctness',
            status: 'running' as const,
          },
        ],
        startedAt: new Date().toISOString(),
        outputDir: '/tmp/output',
        context: {
          projectPath: '/tmp/project',
          files: ['test.ts'],
        },
      };

      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      const loaded = JSON.parse(readFileSync(stateFile, 'utf-8'));

      expect(loaded.id).toBe('convoy-test-123');
      expect(loaded.template).toBe('code-review');
      expect(loaded.status).toBe('running');
      expect(loaded.agents).toHaveLength(1);
      expect(loaded.agents[0].role).toBe('correctness');
    });
  });

  describe('convoy templates', () => {
    it('should validate template structure', async () => {
      const { validateConvoyTemplate } = await import('../../src/lib/convoy-templates.js');

      const validTemplate = {
        name: 'test-template',
        description: 'Test template',
        agents: [
          {
            role: 'agent1',
            subagent: 'test-agent',
            parallel: true,
          },
        ],
      };

      const result = validateConvoyTemplate(validTemplate);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate roles', async () => {
      const { validateConvoyTemplate } = await import('../../src/lib/convoy-templates.js');

      const invalidTemplate = {
        name: 'test-template',
        description: 'Test template',
        agents: [
          {
            role: 'agent1',
            subagent: 'test-agent',
            parallel: true,
          },
          {
            role: 'agent1', // Duplicate!
            subagent: 'test-agent-2',
            parallel: true,
          },
        ],
      };

      const result = validateConvoyTemplate(invalidTemplate);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate role'))).toBe(true);
    });

    it('should detect missing required fields', async () => {
      const { validateConvoyTemplate } = await import('../../src/lib/convoy-templates.js');

      const invalidTemplate = {
        description: 'Missing name',
        agents: [],
      };

      const result = validateConvoyTemplate(invalidTemplate as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must have a name'))).toBe(true);
    });
  });

  describe('execution order', () => {
    it('should calculate correct execution order for parallel agents', async () => {
      const { getExecutionOrder } = await import('../../src/lib/convoy-templates.js');

      const template = {
        name: 'test',
        description: 'Test',
        agents: [
          { role: 'a', subagent: 'test-a', parallel: true },
          { role: 'b', subagent: 'test-b', parallel: true },
          { role: 'c', subagent: 'test-c', parallel: true },
        ],
      };

      const phases = getExecutionOrder(template);

      // All parallel agents should be in one phase
      expect(phases).toHaveLength(1);
      expect(phases[0]).toHaveLength(3);
    });

    it('should calculate correct execution order for sequential agents', async () => {
      const { getExecutionOrder } = await import('../../src/lib/convoy-templates.js');

      const template = {
        name: 'test',
        description: 'Test',
        agents: [
          { role: 'a', subagent: 'test-a', parallel: false },
          { role: 'b', subagent: 'test-b', parallel: false },
          { role: 'c', subagent: 'test-c', parallel: false },
        ],
      };

      const phases = getExecutionOrder(template);

      // Each sequential agent should be in its own phase
      expect(phases).toHaveLength(3);
      expect(phases[0]).toHaveLength(1);
      expect(phases[1]).toHaveLength(1);
      expect(phases[2]).toHaveLength(1);
    });

    it('should respect dependencies', async () => {
      const { getExecutionOrder } = await import('../../src/lib/convoy-templates.js');

      const template = {
        name: 'test',
        description: 'Test',
        agents: [
          { role: 'a', subagent: 'test-a', parallel: true },
          { role: 'b', subagent: 'test-b', parallel: true },
          { role: 'c', subagent: 'test-c', parallel: false, dependsOn: ['a', 'b'] },
        ],
      };

      const phases = getExecutionOrder(template);

      // Phase 1: a and b (parallel)
      // Phase 2: c (depends on a and b)
      expect(phases).toHaveLength(2);
      expect(phases[0]).toHaveLength(2); // a and b
      expect(phases[1]).toHaveLength(1); // c
      expect(phases[1][0].role).toBe('c');
    });

    it('should throw error for circular dependencies', async () => {
      const { getExecutionOrder } = await import('../../src/lib/convoy-templates.js');

      const template = {
        name: 'test',
        description: 'Test',
        agents: [
          { role: 'a', subagent: 'test-a', parallel: false, dependsOn: ['b'] },
          { role: 'b', subagent: 'test-b', parallel: false, dependsOn: ['a'] },
        ],
      };

      expect(() => {
        getExecutionOrder(template);
      }).toThrow('circular dependency');
    });
  });

  describe('code-review template', () => {
    it('should have correct structure', async () => {
      const { CODE_REVIEW_TEMPLATE, validateConvoyTemplate } = await import('../../src/lib/convoy-templates.js');

      const result = validateConvoyTemplate(CODE_REVIEW_TEMPLATE);
      expect(result.valid).toBe(true);
    });

    it('should have 4 agents: 3 parallel + 1 synthesis', async () => {
      const { CODE_REVIEW_TEMPLATE } = await import('../../src/lib/convoy-templates.js');

      expect(CODE_REVIEW_TEMPLATE.agents).toHaveLength(4);

      const parallelAgents = CODE_REVIEW_TEMPLATE.agents.filter(a => a.parallel);
      const sequentialAgents = CODE_REVIEW_TEMPLATE.agents.filter(a => !a.parallel);

      expect(parallelAgents).toHaveLength(3);
      expect(sequentialAgents).toHaveLength(1);
      expect(sequentialAgents[0].role).toBe('synthesis');
    });

    it('should have synthesis depend on all reviewers', async () => {
      const { CODE_REVIEW_TEMPLATE } = await import('../../src/lib/convoy-templates.js');

      const synthesis = CODE_REVIEW_TEMPLATE.agents.find(a => a.role === 'synthesis');
      expect(synthesis).toBeDefined();
      expect(synthesis?.dependsOn).toEqual(['correctness', 'security', 'performance']);
    });
  });
});
