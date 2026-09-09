import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

type JsonObject = Record<string, unknown>

const RETIRED_QUESTION_HOOKS = [
  'ask-user-question-hook',
  'user-prompt-submit-hook',
]

const PROVIDER_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
])

function readObject(path: string): JsonObject {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {}
  } catch {
    return {}
  }
}

function writeObject(path: string, value: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function mergeRecord(a: unknown, b: unknown): JsonObject {
  const left = a && typeof a === 'object' && !Array.isArray(a) ? a as JsonObject : {}
  const right = b && typeof b === 'object' && !Array.isArray(b) ? b as JsonObject : {}
  return { ...left, ...right }
}

function hookCommand(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return ''
  const hooks = (entry as JsonObject).hooks
  if (!Array.isArray(hooks)) return ''
  return hooks.map(hook => {
    if (!hook || typeof hook !== 'object') return ''
    return typeof (hook as JsonObject).command === 'string' ? (hook as JsonObject).command as string : ''
  }).join(' ')
}

function isOverdeckHookCommand(command: string): boolean {
  return command.includes('/.overdeck/bin/')
    || command.includes('$HOME/.overdeck/bin/')
    || command.includes('/.panopticon/bin/')
    || command.includes('$HOME/.panopticon/bin/')
}

function isRetiredOverdeckQuestionHook(entry: unknown): boolean {
  const command = hookCommand(entry)
  return isOverdeckHookCommand(command)
    && RETIRED_QUESTION_HOOKS.some(name => command.includes(`/${name}`))
}

function mergeHooks(userHooks: unknown, managedHooks: unknown): JsonObject {
  const user = userHooks && typeof userHooks === 'object' && !Array.isArray(userHooks) ? userHooks as JsonObject : {}
  const managed = managedHooks && typeof managedHooks === 'object' && !Array.isArray(managedHooks) ? managedHooks as JsonObject : {}
  const result: JsonObject = {}
  for (const event of new Set([...Object.keys(user), ...Object.keys(managed)])) {
    const combined = [
      ...(Array.isArray(user[event]) ? user[event] as unknown[] : [])
        // Native Overdeck/Panopticon registrations are historical copies of
        // the canonical private table. Drop only recognized owned paths, then
        // add the current managed table once below.
        .filter(entry => !isOverdeckHookCommand(hookCommand(entry))),
      ...(Array.isArray(managed[event]) ? managed[event] as unknown[] : []),
    ].filter(entry => !isRetiredOverdeckQuestionHook(entry))
    if (combined.length > 0) result[event] = combined
  }
  return result
}

function mergeSettings(user: JsonObject, managed: JsonObject): JsonObject {
  const result: JsonObject = { ...user, ...managed }
  result.hooks = mergeHooks(user.hooks, managed.hooks)
  result.permissions = mergeRecord(user.permissions, managed.permissions)
  result.enabledPlugins = mergeRecord(user.enabledPlugins, managed.enabledPlugins)
  result.extraKnownMarketplaces = mergeRecord(user.extraKnownMarketplaces, managed.extraKnownMarketplaces)
  const env = mergeRecord(user.env, managed.env)
  for (const key of PROVIDER_ENV_KEYS) delete env[key]
  if (Object.keys(env).length > 0) result.env = env
  else delete result.env
  return result
}

function copyTree(source: string, destination: string): void {
  if (!existsSync(source)) return
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
}

function mergePluginRegistries(nativePlugins: string, managedPlugins: string, launchPlugins: string): void {
  const mergeRegistry = (name: string, nestedKey?: string) => {
    const user = readObject(join(nativePlugins, name))
    const existing = readObject(join(launchPlugins, name))
    const managed = readObject(join(managedPlugins, name))
    let merged = { ...user, ...existing, ...managed }
    if (nestedKey) {
      merged = {
        ...merged,
        [nestedKey]: {
          ...mergeRecord(user[nestedKey], existing[nestedKey]),
          ...mergeRecord(managed[nestedKey], undefined),
        },
      }
    }
    if (Object.keys(merged).length > 0) writeObject(join(launchPlugins, name), merged)
  }
  mergeRegistry('known_marketplaces.json')
  mergeRegistry('installed_plugins.json', 'plugins')
  mergeRegistry('blocklist.json')
}

export interface PrepareClaudeLaunchHomeOptions {
  nativeHome: string
  managedHome: string
  launchHome: string
  persistentHome: string
  projectDir: string
  sharedCredentials: string
}

/**
 * Build a persistent, Overdeck-owned Claude home for a managed launch.
 * Native Claude state is read-only input. Managed and project assets overlay
 * it without modifying repository-native or user-global harness files.
 */
export function prepareClaudeLaunchHomeSync(options: PrepareClaudeLaunchHomeOptions): void {
  const { nativeHome, managedHome, launchHome, persistentHome, projectDir, sharedCredentials } = options
  mkdirSync(launchHome, { recursive: true })

  for (const directory of ['skills', 'agents', 'commands']) {
    const destination = join(launchHome, directory)
    rmSync(destination, { recursive: true, force: true })
    copyTree(join(nativeHome, directory), destination)
    copyTree(join(managedHome, directory), destination)
  }
  copyTree(join(projectDir, 'skills'), join(launchHome, 'skills'))
  copyTree(join(projectDir, '.pan', 'skills'), join(launchHome, 'skills'))

  writeObject(
    join(launchHome, 'settings.json'),
    mergeSettings(readObject(join(nativeHome, 'settings.json')), readObject(join(managedHome, 'settings.json'))),
  )
  const nativeMcp = readObject(join(nativeHome, 'mcp.json'))
  const managedMcp = readObject(join(managedHome, 'mcp.json'))
  writeObject(join(launchHome, 'mcp.json'), {
    ...nativeMcp,
    ...managedMcp,
    mcpServers: mergeRecord(nativeMcp.mcpServers, managedMcp.mcpServers),
  })

  for (const file of ['statusline-command.sh']) {
    const source = join(managedHome, file)
    if (existsSync(source)) cpSync(source, join(launchHome, file), { force: true })
  }

  const launchPlugins = join(launchHome, 'plugins')
  copyTree(join(nativeHome, 'plugins'), launchPlugins)
  copyTree(join(managedHome, 'plugins'), launchPlugins)
  mergePluginRegistries(join(nativeHome, 'plugins'), join(managedHome, 'plugins'), launchPlugins)

  // Persistent private history is intentionally never reset.
  const persistentProjects = join(persistentHome, 'projects')
  mkdirSync(persistentProjects, { recursive: true })
  const launchProjects = join(launchHome, 'projects')
  try { unlinkSync(launchProjects) } catch { /* absent on a fresh run */ }
  symlinkSync(persistentProjects, launchProjects, 'dir')

  // CLAUDE_CONFIG_DIR also relocates Claude's `.claude.json` state. Seed the
  // unattended trust acknowledgements privately, preserving any session state
  // already written by Claude.
  const privateStatePath = join(persistentHome, '.claude.json')
  const privateState = readObject(privateStatePath)
  const projects = mergeRecord(privateState.projects, undefined)
  projects[projectDir] = {
    ...mergeRecord(projects[projectDir], undefined),
    hasTrustDialogAccepted: true,
  }
  writeObject(privateStatePath, {
    ...privateState,
    bypassPermissionsModeAccepted: true,
    projects,
  })
  const launchStatePath = join(launchHome, '.claude.json')
  try { unlinkSync(launchStatePath) } catch { /* absent on a fresh run */ }
  symlinkSync(privateStatePath, launchStatePath)

  // Import credentials once into one Overdeck-private shared refresh chain.
  // Per-agent links target only that private store, never vendor-native state.
  const privateCredentials = join(launchHome, '.credentials.json')
  const nativeCredentials = join(nativeHome, '.credentials.json')
  if (!existsSync(sharedCredentials) && existsSync(nativeCredentials)) {
    mkdirSync(dirname(sharedCredentials), { recursive: true })
    cpSync(nativeCredentials, sharedCredentials, { force: false })
  }
  if (existsSync(sharedCredentials)) {
    try {
      if (lstatSync(privateCredentials).isSymbolicLink() && readlinkSync(privateCredentials) === sharedCredentials) return
      unlinkSync(privateCredentials)
    } catch {
      // Missing destination is expected on first launch.
    }
    symlinkSync(sharedCredentials, privateCredentials)
  }
}

// Stable executable entry used by generated launchers in both tsx development
// and compiled dist layouts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [nativeHome, managedHome, launchHome, persistentHome, projectDir, sharedCredentials] = process.argv.slice(2)
  if (!nativeHome || !managedHome || !launchHome || !persistentHome || !projectDir || !sharedCredentials) {
    throw new Error('usage: claude-launch-home <native-home> <managed-home> <launch-home> <persistent-home> <project-dir> <shared-credentials>')
  }
  prepareClaudeLaunchHomeSync({ nativeHome, managedHome, launchHome, persistentHome, projectDir, sharedCredentials })
}
