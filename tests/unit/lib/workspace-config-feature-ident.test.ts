/**
 * PAN-5062 WI-1: FEATURE_IDENT, the identifier-safe form of FEATURE_NAME used
 * where raw hyphens are invalid (e.g. unquoted SQL identifiers like a dbt
 * dev schema name).
 */
import { describe, expect, it } from 'vitest';
import { replacePlaceholders, toFeatureIdent, type TemplatePlaceholders } from '../../../src/lib/workspace-config.js';

describe('toFeatureIdent', () => {
  it('lowercases and replaces non-identifier characters with underscores', () => {
    expect(toFeatureIdent('min-574')).toBe('min_574');
    expect(toFeatureIdent('MIN-574.1')).toBe('min_574_1');
    expect(toFeatureIdent('pan_5062')).toBe('pan_5062');
  });
});

describe('replacePlaceholders with FEATURE_IDENT', () => {
  it('substitutes {{FEATURE_IDENT}} using the identifier-safe feature name', () => {
    const placeholders: TemplatePlaceholders = {
      FEATURE_NAME: 'min-574',
      FEATURE_IDENT: toFeatureIdent('min-574'),
      FEATURE_FOLDER: 'feature-min-574',
      BRANCH_NAME: 'feature/min-574',
      COMPOSE_PROJECT: 'myn-feature-min-574',
      DOMAIN: 'myn.test',
      PROJECT_NAME: 'myn',
      PROJECT_PATH: '/home/user/Projects/myn',
      PROJECTS_DIR: '/home/user/Projects',
      WORKSPACE_PATH: '/home/user/Projects/myn/workspaces/feature-min-574',
    };

    expect(replacePlaceholders('dev_{{FEATURE_IDENT}}', placeholders)).toBe('dev_min_574');
  });
});
