import chalk from 'chalk';
import { getLinearApiKey } from '../../../lib/shadow-utils.js';

interface LinearState {
  id: string;
  name: string;
  type: string;
  position: number;
}

/**
 * List all workflow states for a Linear team
 */
async function listTeamStates(apiKey: string, teamKey: string): Promise<LinearState[]> {
  const { LinearClient } = await import('@linear/sdk');
  const client = new LinearClient({ apiKey });

  // Find team by key
  const teams = await client.teams({ filter: { key: { eq: teamKey } } });
  if (teams.nodes.length === 0) {
    throw new Error(`Team ${teamKey} not found`);
  }

  const team = teams.nodes[0];
  const states = await team.states();

  return states.nodes.map((s: any) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    position: s.position ?? 0,
  }));
}

/**
 * Archive a custom state in Linear
 * Note: Linear doesn't allow deleting states that have issues, but we can archive them
 */
async function archiveCustomState(apiKey: string, teamKey: string, stateName: string): Promise<boolean> {
  const { LinearClient } = await import('@linear/sdk');
  const client = new LinearClient({ apiKey });

  // Find team by key
  const teams = await client.teams({ filter: { key: { eq: teamKey } } });
  if (teams.nodes.length === 0) {
    throw new Error(`Team ${teamKey} not found`);
  }

  const team = teams.nodes[0];
  const states = await team.states();

  // Find the state by name (case-insensitive)
  const targetState = states.nodes.find(
    (s: any) => s.name.toLowerCase() === stateName.toLowerCase()
  );

  if (!targetState) {
    console.log(chalk.yellow(`State "${stateName}" not found in team ${teamKey}`));
    return false;
  }

  // Check if it's a built-in state type
  const builtInTypes = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
  if (builtInTypes.includes(targetState.type)) {
    console.log(chalk.yellow(`State "${stateName}" is a built-in state type (${targetState.type}) and cannot be archived`));
    return false;
  }

  // Find issues in this state and migrate them before archiving
  const issuesInState = await client.issues({ filter: { state: { id: { eq: targetState.id } } } });
  if (issuesInState.nodes.length > 0) {
    // Determine target state based on current state name
    const targetStateName = stateName.toLowerCase().includes('review') ? 'In Progress' : 'Todo';
    const targetStateObj = states.nodes.find((s: any) => s.name === targetStateName);

    if (targetStateObj) {
      console.log(chalk.blue(`Migrating ${issuesInState.nodes.length} issues from "${stateName}" to "${targetStateName}"...`));
      for (const issue of issuesInState.nodes) {
        try {
          await client.updateIssue(issue.id, { stateId: targetStateObj.id });
        } catch (err: any) {
          console.log(chalk.yellow(`Failed to move issue ${issue.identifier}: ${err.message}`));
        }
      }
    }
  }

  // Archive the state by updating it (Linear uses archive mutation for states)
  // Note: The Linear SDK may not expose archive directly, so we use the raw client
  const archiveMutation = `
    mutation ArchiveWorkflowState($id: String!) {
      workflowStateArchive(id: $id) {
        success
      }
    }
  `;

  try {
    // Linear SDK doesn't expose workflowStateArchive as a top-level method,
    // so we reach into the internal GraphQL client. Guard against undefined
    // to avoid a confusing TypeError if the SDK internals change.
    const internalClient = (client as unknown as { _client?: { request: (query: string, vars: Record<string, unknown>) => Promise<unknown> } })._client;
    if (!internalClient || typeof internalClient.request !== 'function') {
      console.log(chalk.yellow(`Linear SDK internal client unavailable — cannot archive "${stateName}".`));
      console.log(chalk.gray(`Please archive it manually in Linear settings.`));
      return false;
    }
    await internalClient.request(archiveMutation, { id: targetState.id });
    console.log(chalk.green(`Archived state "${stateName}" in team ${teamKey}`));
    return true;
  } catch (error: any) {
    console.log(chalk.yellow(`Could not archive via mutation: ${error.message}`));
    console.log(chalk.gray(`State "${stateName}" exists but could not be archived automatically.`));
    console.log(chalk.gray(`Please archive it manually in Linear settings.`));
    return false;
  }
}

interface ListOptions {
  team?: string;
}

interface CleanupOptions {
  team?: string;
  state?: string;
  dryRun?: boolean;
}

export async function listStatesCommand(options: ListOptions): Promise<void> {
  const apiKey = getLinearApiKey();
  if (!apiKey) {
    console.error(chalk.red('LINEAR_API_KEY not found in ~/.panopticon.env or environment'));
    process.exit(1);
  }

  const teamKey = options.team || 'MIN'; // Default to MIN team

  try {
    const states = await listTeamStates(apiKey, teamKey);

    console.log(chalk.bold(`\nWorkflow states for team ${teamKey}:`));
    console.log('');

    // Group by type
    const grouped = states.reduce((acc, workflowState) => {
      if (!acc[workflowState.type]) acc[workflowState.type] = [];
      acc[workflowState.type].push(workflowState);
      return acc;
    }, {} as Record<string, LinearState[]>);

    for (const [type, typeStates] of Object.entries(grouped)) {
      console.log(chalk.cyan(`${type}:`));
      for (const workflowState of typeStates.sort((a, b) => a.position - b.position)) {
        console.log(`  ${workflowState.name} (position: ${workflowState.position})`);
      }
      console.log('');
    }

    // Highlight custom states
    const builtInTypes = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];
    const customStates = states.filter(s => !builtInTypes.includes(s.type));

    if (customStates.length > 0) {
      console.log(chalk.yellow('Custom states (may need cleanup):'));
      for (const workflowState of customStates) {
        console.log(`  - ${workflowState.name} (type: ${workflowState.type})`);
      }
    }
  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

export async function cleanupStatesCommand(options: CleanupOptions): Promise<void> {
  const apiKey = getLinearApiKey();
  if (!apiKey) {
    console.error(chalk.red('LINEAR_API_KEY not found in ~/.panopticon.env or environment'));
    process.exit(1);
  }

  const teamKey = options.team || 'MIN';
  const stateName = options.state || 'Planning';

  if (options.dryRun) {
    console.log(chalk.gray('Dry run mode - would archive:'));
    console.log(`  Team: ${teamKey}`);
    console.log(`  State: ${stateName}`);
    return;
  }

  console.log(chalk.yellow(`Archiving state "${stateName}" in team ${teamKey}...`));

  try {
    const success = await archiveCustomState(apiKey, teamKey, stateName);
    if (success) {
      console.log(chalk.green('\nCleanup complete!'));
    } else {
      console.log(chalk.yellow('\nCleanup incomplete - manual action may be required'));
      process.exit(1);
    }
  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}
