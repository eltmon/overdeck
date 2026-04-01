/**
 * vBRIEF Plan Builder
 *
 * Fluent API for constructing vBRIEF documents programmatically.
 * All date fields use RFC 3339 date-time format.
 */

import type {
  VBriefDocument,
  VBriefPlan,
  VBriefItem,
  VBriefSubItem,
  VBriefEdgeType,
  VBriefItemStatus,
  VBriefPriority,
  VBriefDifficulty,
} from './types.js';

export class PlanBuilder {
  private plan: VBriefPlan;

  constructor(id: string, title: string) {
    this.plan = {
      id,
      title,
      status: 'draft',
      items: [],
      edges: [],
      narratives: {},
    };
  }

  status(status: string): this {
    this.plan.status = status;
    return this;
  }

  author(author: string): this {
    this.plan.author = author;
    return this;
  }

  tag(...tags: string[]): this {
    if (!this.plan.tags) this.plan.tags = [];
    this.plan.tags.push(...tags);
    return this;
  }

  narrative(key: string, value: string): this {
    if (!this.plan.narratives) this.plan.narratives = {};
    this.plan.narratives[key] = value;
    return this;
  }

  addItem(item: VBriefItem): this {
    this.plan.items.push(item);
    return this;
  }

  addTask(id: string, title: string, opts?: {
    narrative?: string;
    difficulty?: VBriefDifficulty;
    phase?: number;
    priority?: VBriefPriority;
    subItems?: VBriefSubItem[];
  }): this {
    this.plan.items.push({
      id,
      title,
      status: 'pending',
      priority: opts?.priority,
      metadata: {
        difficulty: opts?.difficulty,
        phase: opts?.phase,
      },
      narrative: opts?.narrative ? { Action: opts.narrative } : undefined,
      subItems: opts?.subItems,
    });
    return this;
  }

  blocks(from: string, to: string): this {
    this.plan.edges.push({ from, to, type: 'blocks' });
    return this;
  }

  informs(from: string, to: string): this {
    this.plan.edges.push({ from, to, type: 'informs' });
    return this;
  }

  build(): VBriefDocument {
    const now = new Date().toISOString();
    return {
      vBRIEFInfo: { version: '0.5', created: now },
      plan: { ...this.plan },
    };
  }
}

/**
 * Create a new plan builder.
 */
export function planBuilder(id: string, title: string): PlanBuilder {
  return new PlanBuilder(id, title);
}
