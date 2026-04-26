import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RoleBadge } from '../RoleBadge';

describe('RoleBadge', () => {
  it('renders with role data attribute', () => {
    const { getByTestId } = render(<RoleBadge role="planning" />);
    expect(getByTestId('role-badge').getAttribute('data-role')).toBe('planning');
  });

  it('emits role:role_ when role is reviewer and role_ given', () => {
    const { getByTestId } = render(<RoleBadge role="reviewer" role_="security" />);
    expect(getByTestId('role-badge').getAttribute('data-role')).toBe('reviewer:security');
  });

  it('falls back to plain reviewer when role_ omitted', () => {
    const { getByTestId } = render(<RoleBadge role="reviewer" />);
    expect(getByTestId('role-badge').getAttribute('data-role')).toBe('reviewer');
  });

  it('renders sm size at 18px box', () => {
    const { getByTestId } = render(<RoleBadge role="planning" size="sm" />);
    const el = getByTestId('role-badge');
    expect(el.style.width).toBe('18px');
    expect(el.style.height).toBe('18px');
    expect(el.getAttribute('data-size')).toBe('sm');
  });

  it('renders md size at 24px box', () => {
    const { getByTestId } = render(<RoleBadge role="work" size="md" />);
    const el = getByTestId('role-badge');
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('renders lg size at 32px box', () => {
    const { getByTestId } = render(<RoleBadge role="work" size="lg" />);
    const el = getByTestId('role-badge');
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
  });

  it('renders an icon (svg) inside', () => {
    const { container } = render(<RoleBadge role="work" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses primary color for work role', () => {
    const { getByTestId } = render(<RoleBadge role="work" />);
    expect(getByTestId('role-badge').style.color).toContain('primary');
  });

  it('uses destructive color for security reviewer', () => {
    const { getByTestId } = render(<RoleBadge role="reviewer" role_="security" />);
    expect(getByTestId('role-badge').style.color).toContain('destructive');
  });

  it('uses muted color for legacy role', () => {
    const { getByTestId } = render(<RoleBadge role="legacy" />);
    expect(getByTestId('role-badge').style.color).toContain('muted-foreground');
  });

  it('uses signal-review color for plain review role', () => {
    const { getByTestId } = render(<RoleBadge role="review" />);
    expect(getByTestId('role-badge').style.color).toContain('signal-review');
  });

  it('forwards extra className', () => {
    const { getByTestId } = render(<RoleBadge role="work" className="custom-y" />);
    expect(getByTestId('role-badge').classList.contains('custom-y')).toBe(true);
  });
});
