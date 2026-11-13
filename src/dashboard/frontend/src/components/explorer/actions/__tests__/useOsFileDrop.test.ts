import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 'loading-id'), dismiss: vi.fn() }),
)
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../../../../lib/wsTransport', () => ({ getTransport: () => ({}), dashboardMutationJsonHeaders: async () => ({}) }))

import { ExplorerHttpError } from '../../explorer-http'
import { MAX_UPLOAD_BYTES, snapshotDroppedItems, uploadDroppedItems, type DroppedItem } from '../useOsFileDrop'

function fileItem(name: string, size = 3): DroppedItem {
  const file = new File(['abc'], name)
  if (size !== 3) Object.defineProperty(file, 'size', { value: size })
  return { name, file, isDirectory: false }
}

function fakeActions() {
  return {
    runWrite: vi.fn(async <T>(op: (rootId: string) => Promise<T>) => op('issue:PAN-1')),
    recordCreated: vi.fn(() => 'op-1'),
  }
}

beforeEach(() => {
  toastMock.mockReset()
  toastMock.error.mockReset()
  toastMock.loading.mockClear()
  toastMock.dismiss.mockReset()
})

describe('uploadDroppedItems', () => {
  it('uploads files in order to the folder and commits one op', async () => {
    const upload = vi.fn(async (_root: string, dir: string, file: Blob & { name: string }) => ({
      path: `${dir}/${file.name}`,
      size: 3,
      mtimeMs: 0,
    }))
    const actions = fakeActions()
    const result = await uploadDroppedItems([fileItem('a.png'), fileItem('b.png')], 'docs', actions, { upload })
    expect(upload.mock.calls.map((call) => [call[0], call[1], call[2].name])).toEqual([
      ['issue:PAN-1', 'docs', 'a.png'],
      ['issue:PAN-1', 'docs', 'b.png'],
    ])
    expect(result.uploaded).toEqual(['docs/a.png', 'docs/b.png'])
    expect(actions.recordCreated).toHaveBeenCalledTimes(1)
    expect(actions.recordCreated).toHaveBeenCalledWith(['docs/a.png', 'docs/b.png'], 'upload of 2 files')
    expect(toastMock).toHaveBeenCalledWith('Uploaded 2 files')
    expect(toastMock.dismiss).toHaveBeenCalledWith('loading-id')
  })

  it('names a single uploaded file', async () => {
    const upload = vi.fn(async () => ({ path: 'a.png', size: 3, mtimeMs: 0 }))
    const actions = fakeActions()
    await uploadDroppedItems([fileItem('a.png')], '', actions, { upload })
    expect(actions.recordCreated).toHaveBeenCalledWith(['a.png'], 'upload of a.png')
    expect(toastMock).toHaveBeenCalledWith('Uploaded a.png')
  })

  it('skips a folder with a toast', async () => {
    const upload = vi.fn()
    const actions = fakeActions()
    await uploadDroppedItems([{ name: 'assets', file: null, isDirectory: true }], 'docs', actions, { upload })
    expect(toastMock.error).toHaveBeenCalledWith('Drop files, not folders: assets')
    expect(upload).not.toHaveBeenCalled()
    expect(actions.recordCreated).not.toHaveBeenCalled()
  })

  it('skips a file over 100 MiB without sending it', async () => {
    const upload = vi.fn()
    await uploadDroppedItems([fileItem('big.iso', MAX_UPLOAD_BYTES + 1)], 'docs', fakeActions(), { upload })
    expect(upload).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('big.iso is larger than 100 MiB.')
  })

  it('refuses an existing name and still uploads the next file', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new ExplorerHttpError('exists', 409, 'ALREADY_EXISTS'))
      .mockResolvedValueOnce({ path: 'b.png', size: 3, mtimeMs: 0 })
    const actions = fakeActions()
    const result = await uploadDroppedItems([fileItem('a.png'), fileItem('b.png')], '', actions, { upload })
    expect(toastMock.error).toHaveBeenCalledWith('a.png already exists in the root')
    expect(upload).toHaveBeenCalledTimes(2)
    expect(result.uploaded).toEqual(['b.png'])
  })

  it('names the folder in the existing-name toast and reports other errors', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new ExplorerHttpError('exists', 409, 'ALREADY_EXISTS'))
      .mockRejectedValueOnce(new Error('network down'))
    const actions = fakeActions()
    await uploadDroppedItems([fileItem('a.png'), fileItem('b.png')], 'docs', actions, { upload })
    expect(toastMock.error).toHaveBeenCalledWith('a.png already exists in docs')
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't upload b.png: network down")
    expect(actions.recordCreated).not.toHaveBeenCalled()
  })
})

describe('snapshotDroppedItems', () => {
  function dataTransfer(items: Partial<DataTransferItem>[]): DataTransfer {
    return { items, files: [] } as unknown as DataTransfer
  }

  it('marks a directory entry and treats an item without webkitGetAsEntry as a file', () => {
    const file = new File(['x'], 'notes.txt')
    const items = snapshotDroppedItems(
      dataTransfer([
        { kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ name: 'assets', isDirectory: true }) as FileSystemEntry },
        { kind: 'file', getAsFile: () => file },
        { kind: 'string', getAsFile: () => null },
      ]),
    )
    expect(items).toEqual([
      { name: 'assets', file: null, isDirectory: true },
      { name: 'notes.txt', file, isDirectory: false },
    ])
  })

  it('falls back to dt.files when there are no file items', () => {
    const file = new File(['x'], 'a.txt')
    const items = snapshotDroppedItems({ items: [], files: [file] } as unknown as DataTransfer)
    expect(items).toEqual([{ name: 'a.txt', file, isDirectory: false }])
  })
})
