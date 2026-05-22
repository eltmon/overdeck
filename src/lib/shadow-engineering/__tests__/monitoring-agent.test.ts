import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateBasicInference,
  updateInferenceDocumentSync,
  readInferenceDocumentSync,
  generateMonitoringPrompt,
} from '../monitoring-agent.js';
import { PAN_DIRNAME } from '../../pan-dir/index.js';

describe('Monitoring Agent', () => {
  let testDir: string;
  let workspacePath: string;
  let panDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pan-test-${Date.now()}`);
    workspacePath = join(testDir, 'workspace');
    panDir = join(workspacePath, PAN_DIRNAME);
    mkdirSync(join(panDir, 'transcripts'), { recursive: true });
    mkdirSync(join(panDir, 'discussions'), { recursive: true });
    mkdirSync(join(panDir, 'notes'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('generateBasicInference', () => {
    it('should generate inference from empty artifacts', () => {
      const config = { issueId: 'PAN-123', workspacePath, projectPath: testDir };
      const artifacts = {
        comments: [],
        transcripts: [],
        notes: [],
      };

      const result = generateBasicInference(config, artifacts);

      expect(result).toContain('# Inference Document - PAN-123');
      expect(result).toContain('Analyzed 0 artifact(s)');
      expect(result).toContain('## Artifacts Analyzed');
    });

    it('should include issue description in inference', () => {
      const config = { issueId: 'PAN-456', workspacePath, projectPath: testDir };
      const artifacts = {
        issueDescription: 'Build a new dashboard component for monitoring',
        comments: [],
        transcripts: [],
        notes: [],
      };

      const result = generateBasicInference(config, artifacts);

      expect(result).toContain('## Issue Summary');
      expect(result).toContain('Build a new dashboard component');
    });

    it('should count all artifact types', () => {
      const config = { issueId: 'PAN-789', workspacePath, projectPath: testDir };
      const artifacts = {
        comments: ['comment 1', 'comment 2'],
        transcripts: ['transcript 1'],
        notes: ['note 1', 'note 2', 'note 3'],
      };

      const result = generateBasicInference(config, artifacts);

      expect(result).toContain('Analyzed 6 artifact(s)');
      expect(result).toContain('2 discussion comment(s)');
      expect(result).toContain('1 transcript(s)');
      expect(result).toContain('3 note(s)');
    });

    it('should include code changes when present', () => {
      const config = { issueId: 'PAN-100', workspacePath, projectPath: testDir };
      const artifacts = {
        comments: [],
        transcripts: [],
        notes: [],
        codeChanges: 'abc1234 feat: add feature\ndef5678 fix: fix bug',
      };

      const result = generateBasicInference(config, artifacts);

      expect(result).toContain('## Recent Activity');
      expect(result).toContain('abc1234 feat: add feature');
    });
  });

  describe('updateInferenceDocument', () => {
    it('should write INFERENCE.md to .pan directory', () => {
      updateInferenceDocumentSync(workspacePath, '# Test Inference');

      const filePath = join(panDir, 'INFERENCE.md');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('# Test Inference');
    });

    it('should create .pan directory if it does not exist', () => {
      const newWorkspace = join(testDir, 'new-workspace');
      updateInferenceDocumentSync(newWorkspace, '# New Inference');

      const filePath = join(newWorkspace, PAN_DIRNAME, 'INFERENCE.md');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('readInferenceDocument', () => {
    it('should return null when INFERENCE.md does not exist', () => {
      const result = readInferenceDocumentSync(join(testDir, 'nonexistent'));
      expect(result).toBeNull();
    });

    it('should return content when INFERENCE.md exists', () => {
      writeFileSync(join(panDir, 'INFERENCE.md'), '# Existing Inference', 'utf-8');

      const result = readInferenceDocumentSync(workspacePath);
      expect(result).toBe('# Existing Inference');
    });
  });

  describe('generateMonitoringPrompt', () => {
    it('should include issue ID in prompt', () => {
      const config = { issueId: 'PAN-200', workspacePath, projectPath: testDir };
      const artifacts = {
        comments: [],
        transcripts: [],
        notes: [],
      };

      const result = generateMonitoringPrompt(config, artifacts);

      expect(result).toContain('PAN-200');
      expect(result).toContain('Monitoring Agent');
      expect(result).toContain('INFERENCE.md');
    });

    it('should include existing inference when present', () => {
      const config = { issueId: 'PAN-201', workspacePath, projectPath: testDir };
      const artifacts = {
        comments: [],
        transcripts: [],
        notes: [],
      };
      const existing = '# Existing understanding';

      const result = generateMonitoringPrompt(config, artifacts, existing);

      expect(result).toContain('Current INFERENCE.md');
      expect(result).toContain('Existing understanding');
    });

    it('should include all artifact types in prompt', () => {
      const config = { issueId: 'PAN-202', workspacePath, projectPath: testDir };
      const artifacts = {
        issueDescription: 'Test issue',
        comments: ['Comment 1'],
        transcripts: ['Transcript 1'],
        notes: ['Note 1'],
        codeChanges: 'abc123 feat: test',
      };

      const result = generateMonitoringPrompt(config, artifacts);

      expect(result).toContain('## Issue Description');
      expect(result).toContain('## Discussion Comments');
      expect(result).toContain('## Meeting Transcripts');
      expect(result).toContain('## Notes');
      expect(result).toContain('## Recent Code Changes');
    });
  });
});
