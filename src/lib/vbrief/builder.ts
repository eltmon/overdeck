/**
 * vBRIEF Plan Builder
 *
 * Fluent API for constructing vBRIEF documents programmatically.
 * Used by planning agents to produce structured plans.
 */

import type {
  VBriefDocument,
  Plan,
  PlanItem,
  PlanItemMetadata,
  Edge,
  EdgeType,
  PlanStatus,
  Priority,
  ItemKind,
} from './types.js';

export class PlanBuilder {
  private plan: Plan;

  constructor(title: string) {
    this.plan = {
      title,
      status: 'draft',
      items: [],
      edges: [],
      narratives: {},
      created: new Date().toISOString(),
    };
  }

  // ── Plan-Level Methods ──

  status(status: PlanStatus): this {
    this.plan.status = status;
    return this;
  }

  author(author: string): this {
    this.plan.author = author;
    return this;
  }

  agent(agent: string): this {
    this.plan.agent = agent;
    return this;
  }

  narrative(key: string, value: string): this {
    if (!this.plan.narratives) this.plan.narratives = {};
    this.plan.narratives[key] = value;
    return this;
  }

  uri(key: string, value: string): this {
    if (!this.plan.uris) this.plan.uris = {};
    this.plan.uris[key] = value;
    return this;
  }

  tag(...tags: string[]): this {
    if (!this.plan.tags) this.plan.tags = [];
    this.plan.tags.push(...tags);
    return this;
  }

  // ── Item Methods ──

  addItem(item: PlanItem): this {
    this.plan.items.push(item);
    return this;
  }

  addRequirement(id: string, title: string, opts?: {
    narrative?: string;
    priority?: Priority;
    acceptanceCriteria?: Array<{ id: string; title: string }>;
  }): this {
    const item: PlanItem = {
      id,
      title,
      status: 'pending',
      narrative: opts?.narrative,
      priority: opts?.priority,
      metadata: { kind: 'requirement' },
      subItems: opts?.acceptanceCriteria?.map(ac => ({
        id: ac.id,
        title: ac.title,
        status: 'pending' as PlanStatus,
        metadata: { kind: 'acceptance_criterion' as ItemKind },
      })),
    };
    this.plan.items.push(item);
    return this;
  }

  addArchitecturalDecision(id: string, title: string, narrative: string): this {
    this.plan.items.push({
      id,
      title,
      status: 'approved',
      narrative,
      metadata: { kind: 'architectural_decision' },
    });
    return this;
  }

  addStory(id: string, title: string, opts?: {
    narrative?: string;
    rallyRef?: string;
    planRef?: string;
    priority?: Priority;
  }): this {
    this.plan.items.push({
      id,
      title,
      status: 'pending',
      narrative: opts?.narrative,
      planRef: opts?.planRef,
      priority: opts?.priority,
      metadata: {
        kind: 'story',
        rally_ref: opts?.rallyRef,
      },
    });
    return this;
  }

  addTask(id: string, title: string, opts?: {
    narrative?: string;
    difficulty?: PlanItemMetadata['difficulty'];
    phase?: number;
    priority?: Priority;
  }): this {
    this.plan.items.push({
      id,
      title,
      status: 'pending',
      narrative: opts?.narrative,
      priority: opts?.priority,
      metadata: {
        kind: 'task',
        difficulty: opts?.difficulty,
        phase: opts?.phase,
      },
    });
    return this;
  }

  // ── Edge Methods ──

  addEdge(from: string, to: string, type: EdgeType): this {
    if (!this.plan.edges) this.plan.edges = [];
    this.plan.edges.push({ from, to, type });
    return this;
  }

  blocks(from: string, to: string): this {
    return this.addEdge(from, to, 'blocks');
  }

  informs(from: string, to: string): this {
    return this.addEdge(from, to, 'informs');
  }

  // ── Build ──

  build(): VBriefDocument {
    this.plan.updated = new Date().toISOString();
    return {
      vBRIEFInfo: { version: '0.5', created: this.plan.created, updated: this.plan.updated },
      plan: { ...this.plan },
    };
  }
}

/**
 * Create a new plan builder.
 *
 * @example
 * const doc = planBuilder('MIN-630: Redesign Daily Briefing')
 *   .status('approved')
 *   .narrative('Problem', 'Current briefing is a wall of text')
 *   .addRequirement('api.response', 'Restructure briefing API response', {
 *     acceptanceCriteria: [
 *       { id: 'api.response.ac1', title: 'Response includes urgency_zones array' },
 *     ]
 *   })
 *   .blocks('api.response', 'ui.cards')
 *   .build();
 */
export function planBuilder(title: string): PlanBuilder {
  return new PlanBuilder(title);
}
