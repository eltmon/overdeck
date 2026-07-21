import { describe, expect, it } from 'vitest';
import * as barrel from '../misc.js';

const EXPECTED_EXPORTS = Object.freeze([
  'default',
  'miscRouteLayer',
  'readPackageVersion',
]);

describe('misc route barrel export surface', () => {
  it('preserves the current named exports', () => {
    expect(Object.keys(barrel).sort()).toEqual(EXPECTED_EXPORTS);
  });
});
