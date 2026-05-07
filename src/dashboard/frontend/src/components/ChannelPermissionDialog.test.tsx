import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { ChannelPermissionDialog } from './ChannelPermissionDialog'

const request = {
  requestId: 'perm-123',
  agentId: 'agent-987',
  issueId: 'PAN-987',
  toolName: 'Bash',
  description: 'Run npm test',
  inputPreview: '{"command":"npm test"}',
  createdAt: '2026-05-07T18:30:00.000Z',
}

describe('ChannelPermissionDialog', () => {
  it('renders tool, agent, issue, description, and arguments', () => {
    render(
      <ChannelPermissionDialog
        request={request}
        issueId="PAN-987"
        isOpen
        onAllow={() => {}}
        onDeny={() => {}}
      />,
    )

    expect(screen.getByText('Tool Permission Required')).toBeInTheDocument()
    expect(screen.getByText('agent-987')).toBeInTheDocument()
    expect(screen.getByText('PAN-987')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('Run npm test')).toBeInTheDocument()
    expect(screen.getByText('{"command":"npm test"}')).toBeInTheDocument()
  })

  it('invokes allow and deny callbacks', () => {
    const onAllow = vi.fn()
    const onDeny = vi.fn()

    render(
      <ChannelPermissionDialog
        request={request}
        issueId="PAN-987"
        isOpen
        onAllow={onAllow}
        onDeny={onDeny}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    expect(onAllow).toHaveBeenCalledTimes(1)
    expect(onDeny).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ChannelPermissionDialog
        request={request}
        issueId="PAN-987"
        isOpen={false}
        onAllow={() => {}}
        onDeny={() => {}}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
