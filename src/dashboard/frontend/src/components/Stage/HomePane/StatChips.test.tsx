import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatChips, deriveHomeStats } from './StatChips'

const NOW = 1_700_000_000_000 // fixed clock for deterministic age

describe('deriveHomeStats', () => {
  it('renders a human "N days" age from createdAt', () => {
    expect(deriveHomeStats({ createdAt: NOW - 18 * 86_400_000, now: NOW }).ageLabel).toBe('18 days')
    expect(deriveHomeStats({ createdAt: NOW - 86_400_000, now: NOW }).ageLabel).toBe('1 day')
    expect(deriveHomeStats({ createdAt: NOW - 1000, now: NOW }).ageLabel).toBe('today')
  })

  it('accepts an ISO string createdAt', () => {
    const iso = new Date(NOW - 2 * 86_400_000).toISOString()
    expect(deriveHomeStats({ createdAt: iso, now: NOW }).ageLabel).toBe('2 days')
  })

  it('degrades to an em-dash age and neutral zeros when inputs are absent', () => {
    const s = deriveHomeStats({ now: NOW })
    expect(s.ageLabel).toBe('—')
    expect(s.additions).toBe(0)
    expect(s.deletions).toBe(0)
    expect(s.filesChanged).toBe(0)
    expect(s.conversationCount).toBe(0)
  })

  it('does not fabricate age for an invalid createdAt', () => {
    expect(deriveHomeStats({ createdAt: 'not-a-date', now: NOW }).ageLabel).toBe('—')
  })

  it('passes through diff/files/convos counts', () => {
    const s = deriveHomeStats({
      additions: 12,
      deletions: 3,
      filesChanged: 4,
      conversationCount: 5,
      now: NOW,
    })
    expect(s).toMatchObject({ additions: 12, deletions: 3, filesChanged: 4, conversationCount: 5 })
  })
})

describe('StatChips', () => {
  it('renders age and convos chips from props', () => {
    render(<StatChips createdAt={NOW - 18 * 86_400_000} conversationCount={5} now={NOW} />)
    const row = screen.getByTestId('home-stats')
    expect(row).toHaveTextContent('18 days')
    expect(row).toHaveTextContent('5 convos')
  })

  it('shows neutral zeros when diff/files data is unavailable', () => {
    render(<StatChips now={NOW} />)
    const row = screen.getByTestId('home-stats')
    expect(row).toHaveTextContent('+0')
    expect(row).toHaveTextContent('0 files')
  })
})
