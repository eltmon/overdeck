/**
 * PAN-4589: a Dagger Cloud commit status (`StatusContext`, no `name`) must
 * classify the same way a check run does, through `isCiTestRollupCheck`.
 */
import { describe, expect, it } from 'vitest';

import { listFailedTestChecks, summarizeTestChecks, testJobSucceeded } from '../pr-facts.js';

const daggerUrl = (context: string) =>
  `https://dagger.cloud/o/checks/github.com/o/r@sha?check=${context}`;

const daggerStatus = (context: string, state: string) => ({
  __typename: 'StatusContext',
  context,
  state,
  targetUrl: daggerUrl(context),
});

describe('pr-facts classifiers over StatusContext rows (PAN-4589)', () => {
  it('is green when every Dagger test status succeeded', () => {
    const rollup = [
      daggerStatus('go-client/test', 'SUCCESS'),
      daggerStatus('test-split/test-llm', 'SUCCESS'),
      daggerStatus('helm/lint', 'FAILURE'),
    ];

    expect(summarizeTestChecks(rollup)).toBe('green');
    expect(listFailedTestChecks(rollup)).toEqual([]);
    expect(testJobSucceeded(rollup)).toBe(true);
  });

  it('is red and names the failing Dagger test statuses with their link', () => {
    const rollup = [
      daggerStatus('go-client/test', 'FAILURE'),
      daggerStatus('golang/packages/tests/test', 'ERROR'),
      daggerStatus('python-client/format', 'FAILURE'),
    ];

    expect(summarizeTestChecks(rollup)).toBe('red');
    expect(listFailedTestChecks(rollup)).toEqual([
      { name: 'go-client/test', conclusion: 'FAILURE', targetUrl: daggerUrl('go-client/test') },
      { name: 'golang/packages/tests/test', conclusion: 'ERROR', targetUrl: daggerUrl('golang/packages/tests/test') },
    ]);
    expect(testJobSucceeded(rollup)).toBe(false);
  });

  it('is pending when one test leg is still running and another succeeded (#4021 semantics)', () => {
    const rollup = [
      daggerStatus('go-client/test', 'PENDING'),
      daggerStatus('vitest/projects/tests/test', 'SUCCESS'),
    ];

    expect(summarizeTestChecks(rollup)).toBe('pending');
    expect(testJobSucceeded(rollup)).toBe(true);
  });

  it('is none when the rollup has only non-test Dagger statuses', () => {
    const rollup = [daggerStatus('helm/lint', 'SUCCESS')];

    expect(summarizeTestChecks(rollup)).toBe('none');
    expect(listFailedTestChecks(rollup)).toEqual([]);
  });

  it('is none for a test-named status whose target URL is not Dagger Cloud', () => {
    const rollup = [
      {
        __typename: 'StatusContext',
        context: 'go-client/test',
        state: 'FAILURE',
        targetUrl: 'https://buildkite.com/o/p/builds/1',
      },
    ];

    expect(summarizeTestChecks(rollup)).toBe('none');
    expect(listFailedTestChecks(rollup)).toEqual([]);
  });
});
