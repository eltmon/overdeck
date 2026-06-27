import { describe, expect, it } from 'vitest';
import { groupWaveByEpic, type ForecastNode } from '../BacklogForecast';

function node(issue: string, rank: number): ForecastNode {
  return {
    issue,
    rank,
    size: 'M',
    title: issue,
    importance: 'medium',
    score: 50,
    why: '',
    state: {
      ready: true,
      planned: true,
      parked: false,
      vetoed: false,
      blocksMain: false,
      inPipeline: false,
      released: true,
      objection: false,
      gate: 'auto',
    },
  };
}

describe('groupWaveByEpic', () => {
  it('groups same-epic children contiguously, preserves group pickup order, and keeps orphan cards unchanged', () => {
    const wave = [
      node('PAN-2076', 1),
      node('PAN-9', 2),
      node('PAN-2077', 3),
      node('PAN-10', 4),
      node('PAN-2078', 5),
    ];
    const groups = groupWaveByEpic(wave, new Map([
      ['PAN-2076', 'PAN-2075'],
      ['PAN-2077', 'PAN-2075'],
      ['PAN-2078', 'PAN-2075'],
    ]));

    expect(groups).toEqual([
      { epic: 'PAN-2075', cards: [wave[0], wave[2], wave[4]] },
      { epic: null, cards: [wave[1]] },
      { epic: null, cards: [wave[3]] },
    ]);
  });
});
