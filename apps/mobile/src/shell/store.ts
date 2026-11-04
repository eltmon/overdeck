/**
 * The shell's records (PAN-4837 D-6): the `account` and `machines` secrets in the OverdeckKeys
 * plugin, the current machine in `localStorage`, and a Zustand store the screens read.
 */
import { create } from 'zustand';

import { OverdeckKeys, type OverdeckKeysPlugin } from '../native/keys';
import type { AccountRecord, PairedMachine } from './types';

export const CURRENT_MACHINE_KEY = 'overdeck.currentMachine';

let keys: OverdeckKeysPlugin = OverdeckKeys;

/** Tests swap the plugin for a stand-in. */
export function setKeysPlugin(plugin: OverdeckKeysPlugin): void {
  keys = plugin;
}

async function readJson<T>(name: 'account' | 'machines'): Promise<T | null> {
  const { value } = await keys.getSecret({ name });
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function readAccount(): Promise<AccountRecord | null> {
  return readJson<AccountRecord>('account');
}

export async function writeAccount(account: AccountRecord): Promise<void> {
  await keys.setSecret({ name: 'account', value: JSON.stringify(account) });
}

export async function removeAccount(): Promise<void> {
  await keys.removeSecret({ name: 'account' });
}

export async function readMachines(): Promise<PairedMachine[]> {
  return (await readJson<PairedMachine[]>('machines')) ?? [];
}

export async function writeMachines(machines: readonly PairedMachine[]): Promise<void> {
  await keys.setSecret({ name: 'machines', value: JSON.stringify(machines) });
}

export function currentMachineId(): string | null {
  try {
    return localStorage.getItem(CURRENT_MACHINE_KEY);
  } catch {
    return null;
  }
}

export function setCurrentMachineId(environmentId: string | null): void {
  try {
    if (environmentId === null) localStorage.removeItem(CURRENT_MACHINE_KEY);
    else localStorage.setItem(CURRENT_MACHINE_KEY, environmentId);
  } catch {
    // Storage unavailable; the machine list is shown instead.
  }
}

interface ShellState {
  account: AccountRecord | null;
  machines: PairedMachine[];
  setAccount(account: AccountRecord | null): void;
  setMachines(machines: PairedMachine[]): void;
}

export const useShellStore = create<ShellState>((set) => ({
  account: null,
  machines: [],
  setAccount: (account) => set({ account }),
  setMachines: (machines) => set({ machines }),
}));
