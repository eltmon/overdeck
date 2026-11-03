/** PAN-4473 WI-7: the lobby panel's sections, its seven actions, the disabled state and the error alert. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShareView } from '@overdeck/contracts';

import { SharingLobbyPanel } from '../SharingLobbyPanel';

const avatar = (id: number) => `https://avatars.githubusercontent.com/u/${id}`;
const person = (githubId: number, login: string) => ({ githubId, login, avatarUrl: avatar(githubId) });

function share(overrides: Partial<ShareView> = {}): ShareView {
  return {
    shortCode: 'BCDFGHJK',
    joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
    scope: { kind: 'conversation', conversationId: 'conv-a' },
    createdAt: '2026-11-02T00:00:00.000Z',
    connection: 'connected',
    lastError: null,
    snapshot: {
      shortCode: 'BCDFGHJK',
      scope: { kind: 'conversation', conversationId: 'conv-a' },
      dataOwner: person(1, 'owner'),
      controllerGithubId: 1,
      hostConnected: true,
      participants: [
        { ...person(100, 'alice'), state: 'lobby', contributor: false, connected: true },
        { ...person(200, 'bob'), state: 'admitted', contributor: true, connected: true },
        { ...person(300, 'carol'), state: 'admitted', contributor: false, connected: false },
      ],
      blocked: [person(400, 'dave')],
    },
    ...overrides,
  };
}

describe('SharingLobbyPanel (PAN-4473 WI-7)', () => {
  it('ac1: renders the three sections with each @login and avatar', () => {
    render(<SharingLobbyPanel share={share()} onCommand={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Waiting to join (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'In the room (2)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Blocked (1)' })).toBeTruthy();
    for (const login of ['alice', 'bob', 'carol', 'dave']) expect(screen.getByText(`@${login}`)).toBeTruthy();
    const sources = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toEqual([avatar(100), avatar(200), avatar(300), avatar(400)]);
    expect(screen.getByText('contributor')).toBeTruthy();
    expect(screen.getByText('offline')).toBeTruthy();
  });

  it('ac2/ac3: each of the seven buttons sends exactly its command', () => {
    const onCommand = vi.fn();
    render(<SharingLobbyPanel share={share()} onCommand={onCommand} />);
    const cases: Array<[string, unknown]> = [
      ['Admit @alice', { type: 'admit', githubId: 100 }],
      ['Admit @alice as contributor', { type: 'admit', githubId: 100, contributor: true }],
      ['Revoke @alice', { type: 'revoke', githubId: 100 }],
      ['Remove contributor from @bob', { type: 'set-contributor', githubId: 200, contributor: false }],
      ['Grant contributor to @carol', { type: 'set-contributor', githubId: 300, contributor: true }],
      ['Kick @carol', { type: 'kick', githubId: 300 }],
      ['Un-revoke @dave', { type: 'unrevoke', githubId: 400 }],
    ];
    for (const [name, command] of cases) {
      onCommand.mockClear();
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onCommand.mock.calls[0]?.[0]).toStrictEqual(command);
    }
  });

  it('ac4: disables every action when the host socket is disconnected', () => {
    render(<SharingLobbyPanel share={share({ connection: 'disconnected' })} onCommand={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(10);
    for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables every action while a command is pending', () => {
    render(<SharingLobbyPanel share={share()} onCommand={vi.fn()} pending />);
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('ac5: shows the last service error as an alert', () => {
    render(<SharingLobbyPanel share={share({ lastError: { code: 'unknown_participant', githubId: 5, at: '2026-11-02T00:00:00.000Z' } })} onCommand={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('That person is no longer in the room.');
  });

  it('shows the empty state when no one has joined', () => {
    const base = share();
    render(<SharingLobbyPanel share={{ ...base, snapshot: { ...base.snapshot!, participants: [], blocked: [] } }} onCommand={vi.fn()} />);
    expect(screen.getByText('No one has joined yet. People who open the link wait here until you admit them.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
