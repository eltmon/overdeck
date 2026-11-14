import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  beginEdit: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  beginEdit: mocks.beginEdit,
}))
vi.mock('sonner', () => ({ toast: { warning: mocks.warning, error: mocks.error } }))

import { selectPanesForWorkspace, usePanesStore } from '../../../../lib/panesStore'
import { draftKey, isDraftDirty, useCodeDrafts } from '../../code/code-drafts'
import { useExplorerStore } from '../../explorerStore'
import { useEditWorkspaceStore } from '../edit-workspace-store'
import { ensureEditRoot, leaveEditWorkspace, switchRoot } from '../edit-workspace-switch'

const DECK = 'deck-1'
const PROJECT = 'project:p'
const EDIT = 'workspace:w1'

const panes = () => selectPanesForWorkspace(DECK)(usePanesStore.getState())

function openPane(paneType: 'files' | 'code', rootId: string, path?: string): string {
  return usePanesStore.getState().addPane(DECK, {
    paneType,
    label: path ?? 'Files',
    explorerRootId: rootId,
    ...(path ? { explorerPath: path } : {}),
  })
}

function dirtyDraft(rootId: string, path: string, text: string) {
  const key = draftKey(rootId, path)
  useCodeDrafts.getState().loaded(key, 'base\n', 'sig-base')
  useCodeDrafts.getState().edited(key, text)
  return key
}

beforeEach(() => {
  localStorage.clear()
  mocks.beginEdit.mockReset()
  mocks.warning.mockReset()
  mocks.error.mockReset()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(DECK)
  useCodeDrafts.setState({ drafts: {} })
  useExplorerStore.setState({ roots: {} })
  useEditWorkspaceStore.setState({ creating: {}, active: {}, pending: {} })
})

describe('switchRoot', () => {
  it('re-keys a dirty draft, marks a pending save and retargets the explorer and code panes', () => {
    const oldKey = dirtyDraft(PROJECT, 'README.md', 'edited\n')
    const files = openPane('files', PROJECT)
    const code = openPane('code', PROJECT, 'README.md')
    useExplorerStore.getState().setExpandedMany(PROJECT, ['src'])

    switchRoot(PROJECT, EDIT)

    const newKey = draftKey(EDIT, 'README.md')
    expect(useCodeDrafts.getState().drafts[oldKey]).toBeUndefined()
    expect(useCodeDrafts.getState().drafts[newKey]?.text).toBe('edited\n')
    expect(isDraftDirty(useCodeDrafts.getState().drafts[newKey])).toBe(true)
    expect(useEditWorkspaceStore.getState().pending[newKey]).toBe(true)
    expect(panes().find((p) => p.paneId === files)?.explorerRootId).toBe(EDIT)
    expect(panes().find((p) => p.paneId === code)?.explorerRootId).toBe(EDIT)
    expect(useExplorerStore.getState().roots[EDIT]?.expanded).toEqual(['src'])
  })

  it('does not mark a clean draft for a pending save', () => {
    useCodeDrafts.getState().loaded(draftKey(PROJECT, 'a.txt'), 'a\n', 'sig-a')
    switchRoot(PROJECT, EDIT)
    expect(useEditWorkspaceStore.getState().pending).toEqual({})
  })

  it('replaces a dirty draft at the target key and warns with its path', () => {
    dirtyDraft(EDIT, 'README.md', 'older edit\n')
    dirtyDraft(PROJECT, 'README.md', 'newer edit\n')

    switchRoot(PROJECT, EDIT, { name: 'edit-1113-1405' })

    expect(useCodeDrafts.getState().drafts[draftKey(EDIT, 'README.md')]?.text).toBe('newer edit\n')
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning.mock.calls[0]?.[0]).toContain('README.md')
    expect(mocks.warning.mock.calls[0]?.[0]).toContain('edit-1113-1405')
  })

  it('closes the switching explorer pane when the deck already has one on the edit root', () => {
    const existing = openPane('files', EDIT)
    const switching = openPane('files', PROJECT)

    switchRoot(PROJECT, EDIT)

    const filesPanes = panes().filter((p) => p.paneType === 'files')
    expect(filesPanes.map((p) => p.paneId)).toEqual([existing])
    expect(panes().some((p) => p.paneId === switching)).toBe(false)
  })
})

describe('ensureEditRoot', () => {
  const result = {
    rootId: EDIT,
    workspaceId: 'w1',
    name: 'edit-1113-1405',
    branch: 'scratch/edit-1113-1405',
    path: '/p/workspaces/scratch-edit-1113-1405',
    created: true,
  }

  it('shares one beginEdit call between concurrent callers', async () => {
    mocks.beginEdit.mockResolvedValue(result)
    const [a, b] = await Promise.all([ensureEditRoot(PROJECT), ensureEditRoot(PROJECT)])
    expect(mocks.beginEdit).toHaveBeenCalledTimes(1)
    expect(mocks.beginEdit).toHaveBeenCalledWith('p', false)
    expect(a).toBe(EDIT)
    expect(b).toBe(EDIT)
    expect(useEditWorkspaceStore.getState().active.p).toBe(EDIT)
    expect(useEditWorkspaceStore.getState().creating.p).toBeUndefined()
  })

  it('shows creating while beginEdit runs', async () => {
    let resolve!: (value: typeof result) => void
    mocks.beginEdit.mockReturnValue(new Promise((r) => (resolve = r)))
    const pending = ensureEditRoot(PROJECT)
    expect(useEditWorkspaceStore.getState().creating.p).toBe(true)
    resolve(result)
    await pending
    expect(useEditWorkspaceStore.getState().creating.p).toBeUndefined()
  })

  it('keeps the draft dirty under the project key and rethrows when beginEdit fails', async () => {
    const key = dirtyDraft(PROJECT, 'README.md', 'edited\n')
    mocks.beginEdit.mockRejectedValue(new Error('not a git repository'))
    await expect(ensureEditRoot(PROJECT)).rejects.toThrow('not a git repository')
    expect(isDraftDirty(useCodeDrafts.getState().drafts[key])).toBe(true)
    expect(useEditWorkspaceStore.getState().creating.p).toBeFalsy()
    expect(mocks.error).toHaveBeenCalledWith("Couldn't create an edit workspace: not a git repository")
  })

  it('does not switch panes when forceNew is set', async () => {
    mocks.beginEdit.mockResolvedValue({ ...result, rootId: 'workspace:w2', workspaceId: 'w2' })
    const files = openPane('files', PROJECT)
    expect(await ensureEditRoot(PROJECT, { forceNew: true })).toBe('workspace:w2')
    expect(mocks.beginEdit).toHaveBeenCalledWith('p', true)
    expect(panes().find((p) => p.paneId === files)?.explorerRootId).toBe(PROJECT)
  })
})

describe('leaveEditWorkspace', () => {
  it('drops the edit root drafts and points its panes at the project root', () => {
    const key = dirtyDraft(EDIT, 'README.md', 'edited\n')
    const files = openPane('files', EDIT)
    const code = openPane('code', EDIT, 'README.md')
    useEditWorkspaceStore.getState().setActive('p', EDIT)

    leaveEditWorkspace(EDIT, 'p')

    expect(useCodeDrafts.getState().drafts[key]).toBeUndefined()
    expect(panes().find((p) => p.paneId === files)?.explorerRootId).toBe(PROJECT)
    expect(panes().find((p) => p.paneId === code)?.explorerRootId).toBe(PROJECT)
    expect(useEditWorkspaceStore.getState().active.p).toBeUndefined()
  })
})

describe('switchRoot with a clean source', () => {
  it('keeps a dirty target draft when the source draft is clean', () => {
    dirtyDraft(EDIT, 'README.md', 'unsaved in edit root\n')
    useCodeDrafts.getState().loaded(draftKey(PROJECT, 'README.md'), 'base\n', 'sig-base')
    switchRoot(PROJECT, EDIT)
    expect(useCodeDrafts.getState().drafts[draftKey(EDIT, 'README.md')]?.text).toBe('unsaved in edit root\n')
    expect(useCodeDrafts.getState().drafts[draftKey(PROJECT, 'README.md')]).toBeUndefined()
    expect(mocks.warning).not.toHaveBeenCalled()
  })
})
