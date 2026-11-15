import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { HomeHeader } from './HomeHeader'

vi.mock('../../CommandDeck/ProjectSettingsDisclosure', () => ({
  ProjectSettingsSection: ({ projectKey }: { projectKey: string }) => (
    <div data-testid="project-settings-section" data-project={projectKey} />
  ),
}))

afterEach(() => {
  cleanup()
})

describe('HomeHeader (PAN-5294 G-D2)', () => {
  it('renders the title in display-lg with the repository subtitle and the meta slot', () => {
    render(
      <HomeHeader
        title="Overdeck"
        subtitle="eltmon/overdeck"
        projectKey="overdeck"
        meta={<div data-testid="meta-slot" />}
      />,
    )

    const heading = screen.getByRole('heading', { name: 'Overdeck' })
    expect(heading).toHaveClass('display-lg')
    expect(heading).not.toHaveTextContent('#')
    expect(screen.getByText('eltmon/overdeck')).toBeInTheDocument()
    expect(screen.getByTestId('meta-slot')).toBeInTheDocument()
  })

  it('opens the project settings modal from the Settings button and closes it on Escape', () => {
    render(<HomeHeader title="Overdeck" projectKey="overdeck" />)

    expect(screen.queryByRole('dialog', { name: 'Project settings' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Project settings' })
    expect(within(dialog).getByTestId('project-settings-section')).toHaveAttribute('data-project', 'overdeck')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Project settings' })).not.toBeInTheDocument()
  })

  it('renders no Settings button without a project key', () => {
    render(<HomeHeader title="No project" />)

    expect(screen.getByRole('heading', { name: 'No project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-settings-section')).not.toBeInTheDocument()
  })
})
