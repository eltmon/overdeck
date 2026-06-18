/**
 * vBRIEF Plan Builder
 *
 * Fluent API for constructing vBRIEF documents programmatically.
 * All date fields use RFC 3339 date-time format.
 */

import { createRequire } from 'module';
import type {
  VBriefDocument,
  VBriefPlan,
  VBriefItem,
  VBriefSubItem,
  VBriefEdgeType,
  VBriefItemStatus,
  VBriefPriority,
  VBriefDifficulty,
  VBriefReference,
} from './types.js';

const require = createRequire(import.meta.url);

function getPackageVersion(): string {
  try {
    // Walk up from this file to find package.json
    const pkg = require('../../../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export class PlanBuilder {
  private plan: VBriefPlan;
  private _description?: string;

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

  uid(uid: string): this {
    this.plan.uid = uid;
    return this;
  }

  sequence(seq: number): this {
    this.plan.sequence = seq;
    return this;
  }

  references(refs: VBriefReference[]): this {
    this.plan.references = refs;
    return this;
  }

  created(timestamp: string): this {
    this.plan.created = timestamp;
    return this;
  }

  description(desc: string): this {
    this._description = desc;
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
    items?: VBriefSubItem[];
    /** Legacy input alias retained for call sites that still pass v0.5-style children. */
    subItems?: VBriefSubItem[];
    created?: string;
  }): this {
    this.plan.items.push({
      id,
      title,
      status: 'pending',
      priority: opts?.priority,
      created: opts?.created,
      metadata: {
        difficulty: opts?.difficulty,
        phase: opts?.phase,
      },
      narrative: opts?.narrative ? { Action: opts.narrative } : undefined,
      items: opts?.items ?? opts?.subItems,
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
    const version = getPackageVersion();
    return {
      vBRIEFInfo: {
        version: '0.6',
        created: now,
        author: `overdeck/${version}`,
        description: this._description,
      },
      plan: {
        ...this.plan,
        created: this.plan.created ?? now,
        updated: now,
      },
    };
  }
}

/**
 * Create a new plan builder.
 */
export function planBuilder(id: string, title: string): PlanBuilder {
  return new PlanBuilder(id, title);
}
