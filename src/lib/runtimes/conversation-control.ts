import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { ohmypiFifoPaths } from './ohmypi-fifo.js'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type ControlCommand =
  | {
      id: string
      type: 'prompt' | 'steer' | 'follow_up'
      message: string
      source: 'operator' | 'orchestrator'
    }
  | {
      id: string
      type: 'set_thinking_level'
      level: ThinkingLevel
    }
  | {
      id: string
      type: 'set_model'
      model: string
    }
  | {
      id: string
      type: 'compact'
    }

export interface ConversationControlPaths {
  agentDir: string
  controlDir: string
}

export function conversationControlPaths(agentId: string, home?: string): ConversationControlPaths {
  const { agentDir } = ohmypiFifoPaths(agentId, home)
  return {
    agentDir,
    controlDir: join(agentDir, 'control'),
  }
}

export async function writeConversationControlCommand(
  agentId: string,
  command: ControlCommand,
  home?: string,
): Promise<string> {
  const paths = conversationControlPaths(agentId, home)
  await mkdir(paths.controlDir, { recursive: true, mode: 0o700 })
  await chmod(paths.controlDir, 0o700)

  const finalPath = join(paths.controlDir, `${Date.now()}-${command.id}-${randomUUID()}.json`)
  const tempPath = `${finalPath}.tmp`
  await writeFile(tempPath, `${JSON.stringify(command)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(tempPath, 0o600)
  await rename(tempPath, finalPath)
  await chmod(finalPath, 0o600)
  return finalPath
}
