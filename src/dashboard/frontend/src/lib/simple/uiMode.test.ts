import { describe, expect, it } from 'vitest';

import { initialMode } from './uiMode';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class ThrowingStorage implements Storage {
  readonly length = 0;
  clear(): void {}
  getItem(): string | null {
    throw new Error('storage unavailable');
  }
  key(): string | null {
    return null;
  }
  removeItem(): void {}
  setItem(): void {}
}

describe('initialMode', () => {
  it('fresh storage resolves simple and saves it', () => {
    const storage = new MemoryStorage();
    expect(initialMode(storage)).toBe('simple');
    expect(storage.getItem('overdeck:ui-mode')).toBe('simple');
  });

  it('simple survives a later last-tab write', () => {
    const storage = new MemoryStorage();
    expect(initialMode(storage)).toBe('simple');
    storage.setItem('overdeck:last-tab', 'home');
    expect(initialMode(storage)).toBe('simple');
  });

  it('legacy footprint without ui-mode resolves advanced and saves it', () => {
    const storage = new MemoryStorage();
    storage.setItem('overdeck:last-tab', 'home');
    expect(initialMode(storage)).toBe('advanced');
    expect(storage.getItem('overdeck:ui-mode')).toBe('advanced');
  });

  it('throwing storage resolves simple', () => {
    const storage = new ThrowingStorage();
    expect(initialMode(storage)).toBe('simple');
  });
});
