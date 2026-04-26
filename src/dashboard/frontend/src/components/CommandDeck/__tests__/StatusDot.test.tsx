import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusDot } from '../StatusDot';

describe('StatusDot', () => {
  it('renders with status data attribute', () => {
    const { getByTestId } = render(<StatusDot status="active" />);
    const el = getByTestId('status-dot');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('data-status')).toBe('active');
  });

  it('applies anim-alive-dot-active class for active status', () => {
    const { getByTestId } = render(<StatusDot status="active" />);
    expect(getByTestId('status-dot').classList.contains('anim-alive-dot-active')).toBe(true);
  });

  it('applies anim-alive-dot-thinking class for thinking status', () => {
    const { getByTestId } = render(<StatusDot status="thinking" />);
    expect(getByTestId('status-dot').classList.contains('anim-alive-dot-thinking')).toBe(true);
  });

  it('applies anim-alive-dot-waiting class for waiting status', () => {
    const { getByTestId } = render(<StatusDot status="waiting" />);
    expect(getByTestId('status-dot').classList.contains('anim-alive-dot-waiting')).toBe(true);
  });

  it('applies anim-alive-dot-idle class for idle status', () => {
    const { getByTestId } = render(<StatusDot status="idle" />);
    expect(getByTestId('status-dot').classList.contains('anim-alive-dot-idle')).toBe(true);
  });

  it('applies no animation class for ended status', () => {
    const { getByTestId } = render(<StatusDot status="ended" />);
    const cls = getByTestId('status-dot').className;
    expect(cls).not.toContain('anim-alive-dot');
  });

  it('renders with default sm size (6px)', () => {
    const { getByTestId } = render(<StatusDot status="active" />);
    const el = getByTestId('status-dot');
    expect(el.style.width).toBe('6px');
    expect(el.style.height).toBe('6px');
    expect(el.getAttribute('data-size')).toBe('sm');
  });

  it('renders with md size (8px)', () => {
    const { getByTestId } = render(<StatusDot status="active" size="md" />);
    const el = getByTestId('status-dot');
    expect(el.style.width).toBe('8px');
    expect(el.style.height).toBe('8px');
    expect(el.getAttribute('data-size')).toBe('md');
  });

  it('forwards title attribute', () => {
    const { getByTestId } = render(<StatusDot status="active" title="Agent active" />);
    expect(getByTestId('status-dot').getAttribute('title')).toBe('Agent active');
  });

  it('renders ended status with reduced opacity', () => {
    const { getByTestId } = render(<StatusDot status="ended" />);
    expect(getByTestId('status-dot').style.opacity).toBe('0.45');
  });

  it('forwards extra className', () => {
    const { getByTestId } = render(<StatusDot status="active" className="custom-x" />);
    expect(getByTestId('status-dot').classList.contains('custom-x')).toBe(true);
  });
});
