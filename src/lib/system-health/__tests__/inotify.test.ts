import { describe, expect, it } from 'vitest';

import {
  countInotifyWatches,
  parseProcLimit,
  sampleInotify,
  type InotifyScanAdapters,
} from '../inotify.js';

const FDINFO_THREE_WATCHES = [
  'pos:\t0',
  'flags:\t02004000',
  'mnt_id:\t15',
  'ino:\t1049',
  'inotify wd:1 ino:2 sdev:800011 mask:3cc',
  'inotify wd:2 ino:3 sdev:800011 mask:3cc',
  'inotify wd:3 ino:4 sdev:800011 mask:3cc',
  '',
].join('\n');

describe('countInotifyWatches', () => {
  it('counts inotify wd lines', () => {
    expect(countInotifyWatches(FDINFO_THREE_WATCHES)).toBe(3);
  });

  it('returns zero for a non-inotify fdinfo', () => {
    expect(countInotifyWatches('pos:\t0\nflags:\t02\n')).toBe(0);
  });
});

describe('parseProcLimit', () => {
  it('parses a positive integer', () => {
    expect(parseProcLimit('1048576\n')).toBe(1048576);
  });

  it('rejects garbage and non-positive values', () => {
    expect(parseProcLimit('')).toBeNull();
    expect(parseProcLimit('abc')).toBeNull();
    expect(parseProcLimit('0')).toBeNull();
  });
});

function fakeProc(): InotifyScanAdapters {
  // pid 100 holds two inotify fds (3 + 3 watches); pid 200 holds none;
  // pid 300 is another user's process (EACCES on fd readdir).
  const dirs = new Map<string, string[]>([
    ['/proc', ['100', '200', '300', 'self', 'meminfo']],
    ['/proc/100/fd', ['0', '4', '7']],
    ['/proc/200/fd', ['0']],
  ]);
  const links = new Map<string, string>([
    ['/proc/100/fd/0', '/dev/pts/1'],
    ['/proc/100/fd/4', 'anon_inode:inotify'],
    ['/proc/100/fd/7', 'anon_inode:inotify'],
    ['/proc/200/fd/0', '/dev/null'],
  ]);
  const files = new Map<string, string>([
    ['/proc/100/fdinfo/4', FDINFO_THREE_WATCHES],
    ['/proc/100/fdinfo/7', FDINFO_THREE_WATCHES],
    ['/proc/100/cmdline', 'node\0./node_modules/.bin/vite\0--host\0'],
    ['/proc/sys/fs/inotify/max_user_watches', '1048576\n'],
    ['/proc/sys/fs/inotify/max_user_instances', '8192\n'],
  ]);
  return {
    readdir: async (path) => {
      const entries = dirs.get(path);
      if (!entries) throw new Error('EACCES');
      return entries;
    },
    readlink: async (path) => {
      const target = links.get(path);
      if (!target) throw new Error('ENOENT');
      return target;
    },
    readFile: async (path) => {
      const content = files.get(path);
      if (content == null) throw new Error('ENOENT');
      return content;
    },
  };
}

describe('sampleInotify', () => {
  it('totals watches and instances across readable pids and reports top consumers', async () => {
    const sample = await sampleInotify(fakeProc());
    expect(sample).not.toBeNull();
    expect(sample!.watchesUsed).toBe(6);
    expect(sample!.instancesUsed).toBe(2);
    expect(sample!.watchesMax).toBe(1048576);
    expect(sample!.instancesMax).toBe(8192);
    expect(sample!.topConsumers).toEqual([
      { pid: 100, watches: 6, command: 'node ./node_modules/.bin/vite --host' },
    ]);
  });

  it('returns null when /proc is unavailable', async () => {
    const adapters = fakeProc();
    const sample = await sampleInotify({
      ...adapters,
      readdir: async (path) => {
        if (path === '/proc') throw new Error('ENOENT');
        return adapters.readdir(path);
      },
    });
    expect(sample).toBeNull();
  });
});
