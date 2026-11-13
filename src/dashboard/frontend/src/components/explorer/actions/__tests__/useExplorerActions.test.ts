import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PanRpcError } from '@overdeck/contracts'

const rpc = vi.hoisted(() => ({
  createEntry: vi.fn(),
  renameEntry: vi.fn(),
  copyEntry: vi.fn(),
  trashPath: vi.fn(),
  restoreEntry: vi.fn(),
}))

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../../../../lib/wsTransport', () => ({ getTransport: () => ({}) }))
vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  ...rpc,
}))

import { selectPanesForWorkspace, usePanesStore } from '../../../../lib/panesStore'
import { draftKey, useCodeDrafts } from '../../code/code-drafts'
import { codeSaveQueue } from '../../code/useCodePaneSave'
import { useExplorerStore } from '../../explorerStore'
import { openCodePane } from '../../openCodePane'
import { clearUndoHistory, hasUndo } from '../undo-stack'
import { READ_ONLY_MESSAGE, createExplorerActions, type ExplorerActionsDeps } from '../useExplorerActions'

const ROOT = 'issue:PAN-1'
const DECK_A = 'PAN-1'
const DECK_B = 'PAN-2'

function makeDeps(overrides: Partial<ExplorerActionsDeps> = {}): ExplorerActionsDeps {
  return {
    rootId: ROOT,
    writable: true,
    reloadDirs: vi.fn(),
    refreshGit: vi.fn(),
    openFile: vi.fn(),
    ...overrides,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const codePanes = (deck: string) =>
  selectPanesForWorkspace(deck)(usePanesStore.getState()).filter((pane) => pane.paneType === 'code')

beforeEach(() => {
  localStorage.clear()
  clearUndoHistory()
  vi.restoreAllMocks()
  for (const fn of Object.values(rpc)) fn.mockReset()
  toastMock.mockReset()
  toastMock.error.mockReset()
  rpc.createEntry.mockResolvedValue({ entry: {} })
  rpc.renameEntry.mockResolvedValue({ entry: {} })
  rpc.copyEntry.mockResolvedValue({ entry: {} })
  rpc.restoreEntry.mockResolvedValue({ path: '' })
  useExplorerStore.setState({ roots: {} })
  useCodeDrafts.setState({ drafts: {} })
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(DECK_A)
  usePanesStore.getState().ensureHome(DECK_B)
})

describe('rename', () => {
  it('waits for saves, renames, rekeys drafts, then retargets panes in every deck', async () => {
    openCodePane(DECK_A, { rootId: ROOT, path: 'src/a.ts' })
    openCodePane(DECK_B, { rootId: ROOT, path: 'src/deep/b.ts' })
    useCodeDrafts.getState().loaded(draftKey(ROOT, 'src/a.ts'), 'a', 'sig-a')
    useCodeDrafts.getState().loaded(draftKey(ROOT, 'src/deep/b.ts'), 'b', 'sig-b')
    useCodeDrafts.getState().edited(draftKey(ROOT, 'src/deep/b.ts'), 'b edited')
    useExplorerStore.getState().setExpandedMany(ROOT, ['src', 'src/deep'])

    const idle = deferred()
    const whenIdle = vi.spyOn(codeSaveQueue, 'whenIdle').mockReturnValue(idle.promise)
    const order: string[] = []
    const rekey = vi.spyOn(useCodeDrafts.getState(), 'rekey')
    rekey.mockImplementation((from, to) => {
      order.push('rekey')
      const { [from]: draft, ...rest } = useCodeDrafts.getState().drafts
      useCodeDrafts.setState({ drafts: { ...rest, [to]: draft } })
    })
    const realUpdatePane = usePanesStore.getState().updatePane
    vi.spyOn(usePanesStore.getState(), 'updatePane').mockImplementation((...args) => {
      order.push('updatePane')
      realUpdatePane(...args)
    })
    rpc.renameEntry.mockImplementation(async () => {
      order.push('renameEntry')
      return { entry: {} }
    })

    const deps = makeDeps()
    const pending = createExplorerActions(deps).rename('src', 'lib')
    await Promise.resolve()
    await Promise.resolve()
    expect(whenIdle).toHaveBeenCalledWith(draftKey(ROOT, 'src/a.ts'))
    expect(rpc.renameEntry).not.toHaveBeenCalled()

    idle.resolve()
    await pending

    expect(rpc.renameEntry).toHaveBeenCalledWith(ROOT, 'src', 'lib')
    expect(order.indexOf('renameEntry')).toBeLessThan(order.indexOf('rekey'))
    expect(order.lastIndexOf('rekey')).toBeLessThan(order.indexOf('updatePane'))
    expect(codePanes(DECK_A)[0]).toMatchObject({ explorerPath: 'lib/a.ts', label: 'a.ts' })
    expect(codePanes(DECK_B)[0]).toMatchObject({ explorerPath: 'lib/deep/b.ts', label: 'b.ts' })
    const drafts = useCodeDrafts.getState().drafts
    expect(drafts[draftKey(ROOT, 'lib/a.ts')]).toBeDefined()
    expect(drafts[draftKey(ROOT, 'lib/deep/b.ts')]?.text).toBe('b edited')
    expect(drafts[draftKey(ROOT, 'src/a.ts')]).toBeUndefined()
    expect(useExplorerStore.getState().roots[ROOT].expanded).toEqual(['lib', 'lib/deep'])
    expect(deps.reloadDirs).toHaveBeenCalledWith([''])
    expect(deps.refreshGit).toHaveBeenCalledTimes(1)
  })

  it('undo renames back', async () => {
    const actions = createExplorerActions(makeDeps())
    await actions.rename('src/a.ts', 'b.ts')
    await actions.undo()
    expect(rpc.renameEntry).toHaveBeenLastCalledWith(ROOT, 'src/b.ts', 'src/a.ts')
    expect(toastMock).toHaveBeenCalledWith('Undid rename of a.ts')
  })

  it('does nothing when the name is unchanged', async () => {
    await createExplorerActions(makeDeps()).rename('src/a.ts', 'a.ts')
    expect(rpc.renameEntry).not.toHaveBeenCalled()
    expect(hasUndo(ROOT)).toBe(false)
  })
})

describe('create', () => {
  it('creates, selects, opens a file and commits an undo that trashes it', async () => {
    rpc.trashPath.mockResolvedValue('t1')
    const deps = makeDeps()
    const actions = createExplorerActions(deps)
    await actions.create('src', 'new.ts', 'file')
    expect(rpc.createEntry).toHaveBeenCalledWith(ROOT, 'src/new.ts', 'file')
    expect(useExplorerStore.getState().roots[ROOT].selection).toEqual(['src/new.ts'])
    expect(deps.openFile).toHaveBeenCalledWith('src/new.ts')
    expect(deps.reloadDirs).toHaveBeenCalledWith(['src'])

    await actions.undo()
    expect(rpc.trashPath).toHaveBeenCalledWith(ROOT, 'src/new.ts')
    await actions.redo()
    expect(rpc.restoreEntry).toHaveBeenCalledWith(ROOT, 't1')
    expect(toastMock).toHaveBeenCalledWith('Redid new file new.ts')
  })

  it('does not open a folder', async () => {
    const deps = makeDeps()
    await createExplorerActions(deps).create('', 'lib', 'dir')
    expect(rpc.createEntry).toHaveBeenCalledWith(ROOT, 'lib', 'dir')
    expect(deps.openFile).not.toHaveBeenCalled()
  })
})

describe('project roots and read-only trees', () => {
  it('runWrite rejects on a project root and create sends no RPC', async () => {
    const actions = createExplorerActions(makeDeps({ rootId: 'project:overdeck', writable: false }))
    await expect(actions.runWrite(async () => 'x')).rejects.toThrow(READ_ONLY_MESSAGE)
    await actions.create('', 'a.ts', 'file')
    expect(rpc.createEntry).not.toHaveBeenCalled()
  })

  it('runWrite rejects on a project root even when the caller passes writable', async () => {
    const actions = createExplorerActions(makeDeps({ rootId: 'project:overdeck' }))
    await expect(actions.create('', 'a.ts', 'file')).rejects.toThrow(READ_ONLY_MESSAGE)
    expect(rpc.createEntry).not.toHaveBeenCalled()
  })

  it('a tree that is not writable makes no call', async () => {
    const actions = createExplorerActions(makeDeps({ writable: false }))
    await actions.create('', 'a.ts', 'file')
    await expect(actions.remove(['a.ts'])).resolves.toBe('')
    await actions.move(['a.ts'], 'src')
    expect(rpc.createEntry).not.toHaveBeenCalled()
    expect(rpc.trashPath).not.toHaveBeenCalled()
    expect(rpc.renameEntry).not.toHaveBeenCalled()
  })
})

describe('duplicate', () => {
  it('picks the first free copy name and selects it', async () => {
    const deps = makeDeps()
    await createExplorerActions(deps).duplicate('src/a.ts', ['a.ts', 'a copy.ts'])
    expect(rpc.copyEntry).toHaveBeenCalledWith(ROOT, 'src/a.ts', 'src/a copy 2.ts')
    expect(useExplorerStore.getState().roots[ROOT].selection).toEqual(['src/a copy 2.ts'])
    expect(deps.reloadDirs).toHaveBeenCalledWith(['src'])
  })

  it('retries the next candidate on ALREADY_EXISTS', async () => {
    rpc.copyEntry.mockRejectedValueOnce(new PanRpcError({ code: 'ALREADY_EXISTS', message: 'taken' }))
    await createExplorerActions(makeDeps()).duplicate('a.ts', ['a.ts'])
    expect(rpc.copyEntry.mock.calls.map((call) => call[2])).toEqual(['a copy.ts', 'a copy 2.ts'])
    expect(hasUndo(ROOT)).toBe(true)
  })

  it('toasts any other failure', async () => {
    rpc.copyEntry.mockRejectedValueOnce(new Error('disk full'))
    await createExplorerActions(makeDeps()).duplicate('a.ts', ['a.ts'])
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't duplicate a.ts: disk full")
    expect(hasUndo(ROOT)).toBe(false)
  })
})

describe('remove', () => {
  it('trashes each top-level path once; undo restores in reverse; redo takes new ids', async () => {
    let n = 0
    rpc.trashPath.mockImplementation(async () => `t${++n}`)
    const deps = makeDeps()
    const actions = createExplorerActions(deps)

    const opId = await actions.remove(['a', 'a/b', 'c'])
    expect(opId).not.toBe('')
    expect(rpc.trashPath.mock.calls).toEqual([
      [ROOT, 'a'],
      [ROOT, 'c'],
    ])
    expect(deps.reloadDirs).toHaveBeenCalledWith([''])

    await actions.undo()
    expect(rpc.restoreEntry.mock.calls).toEqual([
      [ROOT, 't2'],
      [ROOT, 't1'],
    ])
    expect(toastMock).toHaveBeenCalledWith('Undid delete of 2 items')

    await actions.redo()
    expect(rpc.trashPath.mock.calls.slice(2)).toEqual([
      [ROOT, 'a'],
      [ROOT, 'c'],
    ])
    rpc.restoreEntry.mockClear()
    await actions.undo()
    expect(rpc.restoreEntry.mock.calls).toEqual([
      [ROOT, 't4'],
      [ROOT, 't3'],
    ])
  })

  it('commits the steps that succeeded and names the path that failed', async () => {
    rpc.trashPath.mockResolvedValueOnce('t1').mockRejectedValueOnce(new Error('busy'))
    const actions = createExplorerActions(makeDeps())
    const opId = await actions.remove(['a', 'b', 'c'])
    expect(opId).not.toBe('')
    expect(rpc.trashPath).toHaveBeenCalledTimes(2)
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete b: busy")

    await actions.undo()
    expect(rpc.restoreEntry.mock.calls).toEqual([[ROOT, 't1']])
    expect(toastMock).toHaveBeenCalledWith('Undid delete of a')
  })

  it('returns an empty op id when nothing moved', async () => {
    rpc.trashPath.mockRejectedValueOnce(new Error('busy'))
    await expect(createExplorerActions(makeDeps()).remove(['a'])).resolves.toBe('')
    expect(hasUndo(ROOT)).toBe(false)
  })

  it('undoEntry undoes the toast op', async () => {
    rpc.trashPath.mockResolvedValue('t1')
    const actions = createExplorerActions(makeDeps())
    const opId = await actions.remove(['a'])
    await actions.undoEntry(opId)
    expect(rpc.restoreEntry).toHaveBeenCalledWith(ROOT, 't1')
  })
})

describe('move', () => {
  it('skips a same-folder source, toasts an into-itself source, and commits one op', async () => {
    const actions = createExplorerActions(makeDeps())
    await actions.move(['dest/x.ts', 'dest', 'a.ts', 'b.ts'], 'dest')
    expect(toastMock.error).toHaveBeenCalledWith("Can't move a folder into itself.")
    expect(rpc.renameEntry.mock.calls).toEqual([
      [ROOT, 'a.ts', 'dest/a.ts'],
      [ROOT, 'b.ts', 'dest/b.ts'],
    ])

    await actions.undo()
    expect(rpc.renameEntry.mock.calls.slice(2)).toEqual([
      [ROOT, 'dest/b.ts', 'b.ts'],
      [ROOT, 'dest/a.ts', 'a.ts'],
    ])
    expect(toastMock).toHaveBeenCalledWith('Undid move of 2 items')
  })

  it('stops at the first failure and keeps the moves that succeeded', async () => {
    rpc.renameEntry.mockResolvedValueOnce({ entry: {} }).mockRejectedValueOnce(new Error('locked'))
    const actions = createExplorerActions(makeDeps())
    await actions.move(['a.ts', 'b.ts', 'c.ts'], 'dest')
    expect(rpc.renameEntry).toHaveBeenCalledTimes(2)
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't move b.ts: locked")
    expect(hasUndo(ROOT)).toBe(true)
  })
})

describe('recordCreated and undo errors', () => {
  it('commits one step per uploaded path that trashes on undo', async () => {
    rpc.trashPath.mockResolvedValue('t1')
    const actions = createExplorerActions(makeDeps())
    expect(actions.recordCreated(['up/a.png', 'up/b.png'], 'upload of 2 files')).not.toBe('')
    await actions.undo()
    expect(rpc.trashPath.mock.calls).toEqual([
      [ROOT, 'up/b.png'],
      [ROOT, 'up/a.png'],
    ])
  })

  it('names the op when its undo fails', async () => {
    rpc.trashPath.mockRejectedValueOnce(new Error('gone'))
    const actions = createExplorerActions(makeDeps())
    await actions.create('', 'n.ts', 'file')
    await actions.undo()
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't undo new file n.ts: gone")
  })

  it('shows nothing when there is nothing to undo', async () => {
    await createExplorerActions(makeDeps()).undo()
    expect(toastMock).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
  })
})
