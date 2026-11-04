/**
 * Agent-only lane tools (PAN-4938, PAN-4927 W-DEL1, D-11, D-13). `lane_start`
 * launches a gauntlet lane under the calling conversation through
 * `POST /api/self/lanes`, which takes the parent from the agent token; the
 * tool sends no parent and no CPU-pressure `force`. `lane_status` and
 * `lane_stop` call the lane routes.
 */
import { MACHINE_PROPERTY, NEEDS_PROPERTY } from './tools-write.js';
import { type OverdeckTool, requiredString, routeResult } from './tool.js';

const LANE_PROPERTY = { type: 'string', description: 'The lane conversation name.' } as const;

const laneStart: OverdeckTool = {
  name: 'lane_start',
  description: 'Launch a gauntlet lane (a conversation with a run, key and role) under this conversation. Then call lane_wait for its report.',
  scope: 'operate',
  audience: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['builder', 'critic', 'verifier', 'play', 'orchestrator'], description: 'The lane role.' },
      brief: { type: 'string', description: 'The brief text.' },
      key: { type: 'string', description: 'Lane key inside the run (required unless for).' },
      for: { type: 'string', description: 'Critic (required) or verifier: the builder lane key judged; key defaults to it.' },
      run: { type: 'string', description: 'Run key (inherited inside an orchestrator lane).' },
      project: { type: 'string', description: 'The registered project; default this conversation\'s project.' },
      model: { type: 'string', description: 'The model id or alias.' },
      harness: { type: 'string', description: 'The agent harness, such as claude-code or codex.' },
      effort: { type: 'string', description: 'Reasoning effort: low, medium, high, xhigh or max.' },
      title: { type: 'string', description: 'The lane conversation title.' },
      branch: { type: 'string', description: 'Builder branch (default: <run>/<key>).' },
      from: { type: 'string', description: 'Base ref for a new builder branch.' },
      at: { type: 'string', description: 'Commit a critic or verifier judges (default with for: the builder\'s newest done head).' },
      machine: MACHINE_PROPERTY,
      needs: NEEDS_PROPERTY,
      reuse: { type: 'boolean', description: 'Continue in the directory of the latest earlier lane with the same run, key and role.' },
      replace: { type: 'boolean', description: 'Stop the live lane with the same run, key and role first.' },
    },
    required: ['role', 'brief'],
  },
  async run(args, ctx) {
    const role = requiredString(args, 'role');
    if (!role.ok) return role.error;
    const brief = requiredString(args, 'brief');
    if (!brief.ok) return brief.error;
    const { parent: _parent, force: _force, ...body } = args;
    return routeResult(await ctx.api.request('POST', '/api/self/lanes', body));
  },
};

const laneStatus: OverdeckTool = {
  name: 'lane_status',
  description: 'Read one lane: its role, run, key, state and newest report.',
  scope: 'read:state',
  audience: 'agent',
  inputSchema: { type: 'object', properties: { lane: LANE_PROPERTY }, required: ['lane'] },
  async run(args, ctx) {
    const lane = requiredString(args, 'lane');
    if (!lane.ok) return lane.error;
    return routeResult(await ctx.api.request('GET', `/api/lanes/${encodeURIComponent(lane.value)}`));
  },
};

const laneStop: OverdeckTool = {
  name: 'lane_stop',
  description: 'Stop a lane, here or on the machine it runs on.',
  scope: 'operate',
  audience: 'agent',
  inputSchema: { type: 'object', properties: { lane: LANE_PROPERTY }, required: ['lane'] },
  async run(args, ctx) {
    const lane = requiredString(args, 'lane');
    if (!lane.ok) return lane.error;
    return routeResult(await ctx.api.request('POST', `/api/lanes/${encodeURIComponent(lane.value)}/stop`, {}));
  },
};

export const LANE_TOOLS: readonly OverdeckTool[] = [laneStart, laneStatus, laneStop];
