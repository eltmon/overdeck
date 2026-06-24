import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentDock } from './AgentDock'

describe('AgentDock', () => {
  it('renders a pill per agent plus "+ More Agents"', () => {
    render(<AgentDock onSelectAgent={() => {}} />)
    expect(screen.getByRole('button', { name: /Claude Code/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Codex/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /More Agents/ })).toBeTruthy()
  })

  it('fires onSelectAgent with the agent id when a pill is clicked', () => {
    const onSelectAgent = vi.fn()
    render(<AgentDock onSelectAgent={onSelectAgent} />)
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))
    expect(onSelectAgent).toHaveBeenCalledWith('codex')
  })

  it('fires onMore for the "+ More Agents" affordance', () => {
    const onMore = vi.fn()
    render(<AgentDock onSelectAgent={() => {}} onMore={onMore} />)
    fireEvent.click(screen.getByRole('button', { name: /More Agents/ }))
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('renders a custom agent list', () => {
    render(
      <AgentDock
        agents={[{ id: 'gemini', label: 'Gemini' }]}
        onSelectAgent={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Gemini/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Claude Code/ })).toBeNull()
  })

  it('renders harness marks for claude-code, codex, and ohmypi agents', () => {
    render(
      <AgentDock
        agents={[
          { id: 'claude-code', label: 'Claude Code' },
          { id: 'codex', label: 'Codex' },
          { id: 'ohmypi', label: 'oh-my-pi' },
        ]}
        onSelectAgent={() => {}}
      />,
    )

    expect(screen.getByLabelText('Claude Code logo')).toHaveAttribute('viewBox', '0 0 256 257')
    expect(screen.getByLabelText('Codex logo')).toHaveAttribute('viewBox', '0 0 256 260')
    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument()
    expect(screen.getByText('π')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-icon-bot')).toBeNull()
  })

  it('keeps the bot fallback for unknown agent ids', () => {
    render(
      <AgentDock
        agents={[{ id: 'gemini', label: 'Gemini' }]}
        onSelectAgent={() => {}}
      />,
    )

    expect(screen.getByTestId('agent-icon-bot')).toBeInTheDocument()
  })
})
