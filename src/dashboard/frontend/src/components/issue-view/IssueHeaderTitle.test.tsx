import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IssueHeaderTitle } from './IssueHeaderTitle'

describe('IssueHeaderTitle (PAN-5171)', () => {
  it('renders the title when one is given', () => {
    render(<IssueHeaderTitle issueId="PAN-1" title="A real title" status="ready" />)

    expect(screen.getByText('A real title')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-title-skeleton')).toBeNull()
    expect(screen.queryByTestId('issue-title-hint')).toBeNull()
    expect(screen.queryByText('Issue details')).toBeNull()
  })

  it('renders the skeleton and sr-only text while loading', () => {
    render(<IssueHeaderTitle issueId="PAN-1" title={null} status="loading" />)

    expect(screen.getByTestId('issue-title-skeleton')).toBeInTheDocument()
    expect(screen.getByText('Loading issue title')).toBeInTheDocument()
    expect(screen.queryByText('Issue details')).toBeNull()
  })

  it('renders the identifier and "title unavailable" when unavailable', () => {
    render(<IssueHeaderTitle issueId="PAN-1" title={null} status="unavailable" />)

    expect(screen.getByText('PAN-1')).toBeInTheDocument()
    expect(screen.getByText('title unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Issue details')).toBeNull()
  })

  it('renders the identifier and "not found on tracker" when not-found', () => {
    render(<IssueHeaderTitle issueId="PAN-1" title={null} status="not-found" />)

    expect(screen.getByText('PAN-1')).toBeInTheDocument()
    expect(screen.getByText('not found on tracker')).toBeInTheDocument()
    expect(screen.queryByText('Issue details')).toBeNull()
  })
})
