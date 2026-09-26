/**
 * Command groups that register on demand (PAN-4195).
 *
 * Commands defined directly in the CLI entry register their metadata eagerly
 * and load their implementation through `lazyAction`. The groups below live
 * in modules whose registration code sits beside heavy implementation imports,
 * so the entry loads a group's module only when argv invokes one of its
 * top-level names. `--help`, `help`, the bare program and any name no group or
 * entry command claims still register every group, in the original order, so
 * root help and unknown-command errors stay byte-identical.
 *
 * `names` lists every top-level name and alias the group registers; a test
 * checks it against the real registration. A missing name is still correct
 * (the unmatched name falls back to registering every group), just slower.
 */
import { group } from './command-group-loader.js';

export const COMMAND_GROUPS = {
  review: group({
    names: ['review'],
    load: () => import('./commands/review-subcommands.js'),
    register: (mod, program) => mod.registerReviewCommands(program),
  }),
  monitor: group({
    names: ['monitor', 'inbox'],
    load: () => import('./commands/monitor.js'),
    register: (mod, program) => mod.registerMonitorCommands(program),
  }),
  resetSession: group({
    names: ['reset-session'],
    load: () => import('./commands/reset-session.js'),
    register: (mod, program) => mod.registerResetSessionCommand(program),
  }),
  close: group({
    names: ['close'],
    load: () => import('./commands/close.js'),
    register: (mod, program) => mod.registerCloseCommand(program),
  }),
  knowledge: group({
    names: ['knowledge'],
    load: () => import('./commands/knowledge.js'),
    register: (mod, program) => { mod.configureKnowledgeCommand(program); },
  }),
  swarm: group({
    names: ['swarm'],
    load: () => import('./commands/swarm.js'),
    register: (mod, program) => mod.registerSwarmCommands(program),
  }),
  task: group({
    names: ['task'],
    load: () => import('./commands/task.js'),
    register: (mod, program) => mod.registerTaskCommands(program),
  }),
  workspace: group({
    names: ['workspace'],
    load: () => import('./commands/workspace.js'),
    register: (mod, program) => mod.registerWorkspaceCommands(program),
  }),
  test: group({
    names: ['test'],
    load: () => import('./commands/test.js'),
    register: (mod, program) => mod.registerTestCommands(program),
  }),
  tts: group({
    names: ['tts'],
    load: () => import('./commands/tts.js'),
    register: (mod, program) => mod.registerTtsCommands(program),
  }),
  release: group({
    names: ['release'],
    load: () => import('./commands/release.js'),
    register: (mod, program) => mod.registerReleaseCommands(program),
  }),
  rollout: group({
    names: ['rollout'],
    load: () => import('./commands/rollout.js'),
    register: (mod, program) => mod.registerRolloutCommands(program),
  }),
  memory: group({
    names: ['memory'],
    load: () => import('./commands/memory.js'),
    register: (mod, program) => { program.addCommand(mod.createMemoryCommand()); },
  }),
  briefing: group({
    names: ['briefing'],
    load: () => import('./commands/briefing.js'),
    register: (mod, program) => { program.addCommand(mod.createBriefingCommand()); },
  }),
  compliance: group({
    names: ['compliance'],
    load: () => import('./commands/compliance.js'),
    register: (mod, program) => { program.addCommand(mod.createComplianceCommand()); },
  }),
  registry: group({
    names: ['registry'],
    load: () => import('./commands/registry.js'),
    register: (mod, program) => { program.addCommand(mod.createRegistryCommand()); },
  }),
  orders: group({
    names: ['orders'],
    load: () => import('./commands/orders.js'),
    register: (mod, program) => { program.addCommand(mod.createOrdersCommand()); },
  }),
  parked: group({
    names: ['parked'],
    load: () => import('./commands/parked.js'),
    register: (mod, program) => { program.addCommand(mod.createParkedCommand()); },
  }),
  docs: group({
    names: ['docs'],
    load: () => import('./commands/docs.js'),
    register: (mod, program) => { program.addCommand(mod.createDocsCommand()); },
  }),
  admin: group({
    names: ['admin'],
    load: () => import('./commands/admin/index.js'),
    register: (mod, program, demand) => mod.registerAdminCommands(program, demand === 'all' ? 'all' : undefined),
  }),
  conversations: group({
    names: ['conversations', 'conv'],
    load: () => import('./commands/conversations/index.js'),
    register: (mod, program) => mod.registerConversationsCommands(program),
  }),
  ohmypiAuth: group({
    names: ['ohmypi-auth', 'pi-auth'],
    load: () => import('./commands/ohmypi-auth.js'),
    register: (mod, program) => mod.registerOhmypiAuthCommands(program),
  }),
  install: group({
    names: ['install'],
    load: () => import('./commands/install.js'),
    register: (mod, program) => mod.registerInstallCommand(program),
  }),
  caveman: group({
    names: ['caveman-compress'],
    load: () => import('./commands/caveman.js'),
    register: (mod, program) => mod.registerCavemanCommands(program),
  }),
  scope: group({
    names: ['scope'],
    load: () => import('./commands/scope.js'),
    register: (mod, program) => mod.registerScopeCommands(program),
  }),
  spawn: group({
    names: ['spawn'],
    load: () => import('./commands/spawn.js'),
    register: (mod, program) => mod.registerSpawnCommand(program),
  }),
  worker: group({
    names: ['worker'],
    load: () => import('./commands/worker.js'),
    register: (mod, program) => mod.registerWorkerCommands(program),
  }),
  lane: group({
    names: ['lane'],
    load: () => import('./commands/lane.js'),
    register: (mod, program) => mod.registerLaneCommands(program),
  }),
  flywheel: group({
    names: ['flywheel'],
    load: () => import('./commands/flywheel.js'),
    register: (mod, program) => mod.registerFlywheelCommands(program),
  }),
  merge: group({
    names: ['merge'],
    load: () => import('./commands/merge.js'),
    register: (mod, program) => mod.registerMergeCommands(program),
  }),
  artifacts: group({
    names: ['artifacts'],
    load: () => import('./commands/artifacts.js'),
    register: (mod, program) => mod.registerArtifactCommands(program),
  }),
  project: group({
    names: ['project', 'projects'],
    load: () => import('./commands/project.js'),
    register: (mod, program) => {
      mod.registerProjectCommands(program.command('project').description('Project registry for multi-project workspace support'));
      mod.registerProjectCommands(program.command('projects').description('Project registry for multi-project workspace support'));
    },
  }),
  resources: group({
    names: ['resources', 'hygiene'],
    load: () => import('./commands/resources.js'),
    register: (mod, program) => mod.registerResourceCommands(program),
  }),
  cost: group({
    names: ['cost'],
    load: () => import('./commands/cost.js'),
    register: (mod, program) => { program.addCommand(mod.createCostCommand()); },
  }),
};

export type CommandGroupKey = keyof typeof COMMAND_GROUPS;
