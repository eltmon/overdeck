import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareClaudeLaunchHomeSync } from '../claude-launch-home.js'

describe('prepareClaudeLaunchHomeSync', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('reads native state without mutating it and builds an isolated merged home', () => {
    const root = mkdtempSync(join(tmpdir(), 'overdeck-claude-launch-'))
    roots.push(root)
    const nativeHome = join(root, 'native')
    const managedHome = join(root, 'managed')
    const launchHome = join(root, 'launch')
    const persistentHome = join(root, 'persistent')
    const projectDir = join(root, 'lexerra')
    const sharedCredentials = join(root, 'private-credentials', '.credentials.json')
    for (const dir of [nativeHome, managedHome, join(nativeHome, 'skills', 'user'), join(managedHome, 'skills', 'managed'), join(projectDir, '.pan', 'skills', 'lexerra')]) mkdirSync(dir, { recursive: true })
    const nativeInstruction = join(nativeHome, 'CLAUDE.md')
    writeFileSync(nativeInstruction, '# Lexerra user context\n')
    writeFileSync(join(nativeHome, '.credentials.json'), '{"native":true}\n', { mode: 0o600 })
    writeFileSync(join(nativeHome, 'settings.json'), JSON.stringify({
      theme: 'dark',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/opt/user/notify' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: '$HOME/.overdeck/bin/old-hook' }] }],
      },
    }))
    writeFileSync(join(managedHome, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/private/current-hook' }] }] } }))
    writeFileSync(join(nativeHome, 'mcp.json'), JSON.stringify({ mcpServers: { user: { command: 'user' } } }))
    writeFileSync(join(managedHome, 'mcp.json'), JSON.stringify({ mcpServers: { managed: { command: 'managed' } } }))
    writeFileSync(join(nativeHome, 'skills', 'user', 'SKILL.md'), 'user')
    writeFileSync(join(managedHome, 'skills', 'managed', 'SKILL.md'), 'managed')
    writeFileSync(join(projectDir, '.pan', 'skills', 'lexerra', 'SKILL.md'), 'lexerra')
    const before = statSync(nativeInstruction)

    prepareClaudeLaunchHomeSync({ nativeHome, managedHome, launchHome, persistentHome, projectDir, sharedCredentials })

    const after = statSync(nativeInstruction)
    expect({ ino: after.ino, size: after.size, mtimeMs: after.mtimeMs }).toEqual({ ino: before.ino, size: before.size, mtimeMs: before.mtimeMs })
    expect(readFileSync(nativeInstruction, 'utf8')).toBe('# Lexerra user context\n')
    expect(existsSync(join(launchHome, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(launchHome, 'skills', 'user', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(launchHome, 'skills', 'managed', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(launchHome, 'skills', 'lexerra', 'SKILL.md'))).toBe(true)
    const settings = JSON.parse(readFileSync(join(launchHome, 'settings.json'), 'utf8'))
    expect(settings.theme).toBe('dark')
    expect(JSON.stringify(settings)).toContain('/opt/user/notify')
    expect(JSON.stringify(settings)).toContain('/private/current-hook')
    expect(JSON.stringify(settings)).not.toContain('/.overdeck/bin/old-hook')
    const mcp = JSON.parse(readFileSync(join(launchHome, 'mcp.json'), 'utf8'))
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(['managed', 'user'])
    const state = JSON.parse(readFileSync(join(persistentHome, '.claude.json'), 'utf8'))
    expect(state.bypassPermissionsModeAccepted).toBe(true)
    expect(state.projects[projectDir].hasTrustDialogAccepted).toBe(true)
    expect(lstatSync(join(launchHome, '.credentials.json')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(launchHome, '.credentials.json'))).toBe(sharedCredentials)
  })

  it('preserves the shared private refresh token across later native changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'overdeck-claude-auth-'))
    roots.push(root)
    const nativeHome = join(root, 'native')
    mkdirSync(nativeHome, { recursive: true })
    writeFileSync(join(nativeHome, '.credentials.json'), 'native-old')
    const options = {
      nativeHome,
      managedHome: join(root, 'managed'),
      launchHome: join(root, 'launch'),
      persistentHome: join(root, 'persistent'),
      projectDir: join(root, 'myn'),
      sharedCredentials: join(root, 'credentials', '.credentials.json'),
    }
    prepareClaudeLaunchHomeSync(options)
    writeFileSync(options.sharedCredentials, 'private-refreshed')
    writeFileSync(join(nativeHome, '.credentials.json'), 'native-new')
    prepareClaudeLaunchHomeSync(options)
    expect(readFileSync(options.sharedCredentials, 'utf8')).toBe('private-refreshed')
  })
})
