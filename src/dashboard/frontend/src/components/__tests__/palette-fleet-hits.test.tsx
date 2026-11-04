/** PAN-4651 WI-21 (D-4651-16): fleet palette hits group per machine and open the linked conversation. */
import { describe, expect, it, vi } from 'vitest';

import { fleetHitActions } from '../palette-fleet-hits';
import type { PaletteConversationHit } from '../palette-conversation-hits';

const HIT: PaletteConversationHit = {
  sessionId: 'sess-1', conversationId: '@env-desk/conv-a', projectId: '', projectKey: null, title: 'Fix the cache', archived: false,
  matchTier: 'title', hitCount: 0, role: '', ts: null, byteOffset: null, displayContent: 'Fix the cache', excerpt: '', excerptSegments: [], rank: 1,
};

describe('fleet palette hits (PAN-4651 WI-21)', () => {
  it('ac21: groups hits "On desk" with @<env>/<name> ids, and choosing one opens /conv/@<env>/<name>', () => {
    const open = vi.fn();
    const actions = fleetHitActions([
      { environmentId: 'env-desk', label: 'desk', conversations: [HIT] },
      { environmentId: 'env-lab', label: 'lab', conversations: [], error: 'did not answer within 2.5 s' },
    ], open);
    expect(actions.map((action) => [action.group, action.label])).toEqual([['On desk', 'Fix the cache']]);
    actions[0]!.onSelect();
    expect(open).toHaveBeenCalledWith('/conv/@env-desk/conv-a');
  });
});
