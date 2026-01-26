/**
 * Event-Sourced Cost Tracking
 *
 * Eliminates redundant session file parsing by using:
 * 1. Hook-based real-time collection
 * 2. Append-only event log
 * 3. Pre-computed aggregation cache
 * 4. One-time historical migration
 * 5. 90-day rolling retention
 */

export * from './types.js';
export * from './events.js';
export * from './aggregator.js';
export * from './migration.js';
export * from './pricing.js';
export * from './retention.js';
