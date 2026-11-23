/** PAN-5598 WI-5: moved out of the dashboard route so `GET /api/orders/:id/preview-brief` and `pan orders preview` share it. */
import type { OrderBook } from '@overdeck/contracts';

export function previewBrief(book: OrderBook): string {
  const lines = [
    `# Special orders: ${book.name}`,
    '',
    `Order book: ${book.id}`,
    `Posture: ${book.settings.posture.toUpperCase()}`,
    '',
    'This order book defines the operator-released scope. Standard flywheel doctrine and the standard brief remain in force.',
  ];
  for (const laneName of ['A', 'B'] as const) {
    lines.push('', `## Lane ${laneName}`);
    const items = book.items
      .filter((item) => item.lane === laneName)
      .sort((left, right) => left.order - right.order);
    if (items.length === 0) {
      lines.push('- Empty');
      continue;
    }
    for (const item of items) {
      const flags = [
        item.prereqs.length > 0 ? `after ${item.prereqs.join(', ')}` : '',
        item.reVerify ? 're-verify PRD' : '',
        item.planAtPickup ? 'plan at pickup' : '',
      ].filter(Boolean);
      lines.push(`- ${laneName}${item.order} ${item.issue}${flags.length ? ` — ${flags.join('; ')}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
