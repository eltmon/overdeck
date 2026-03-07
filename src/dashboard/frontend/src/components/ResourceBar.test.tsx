import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceBar } from './ResourceBar';

describe('ResourceBar', () => {
  it('renders with label and value', () => {
    render(<ResourceBar value={45} label="CPU" />);
    expect(screen.getByText('CPU')).toBeTruthy();
    expect(screen.getByText('45.0%')).toBeTruthy();
  });

  it('clamps value above 100 to 100%', () => {
    render(<ResourceBar value={150} label="MEM" />);
    expect(screen.getByText('100.0%')).toBeTruthy();
  });

  it('clamps negative value to 0%', () => {
    render(<ResourceBar value={-10} label="CPU" />);
    expect(screen.getByText('0.0%')).toBeTruthy();
  });

  it('hides value when showValue=false', () => {
    const { container } = render(<ResourceBar value={50} label="CPU" showValue={false} />);
    expect(container.textContent).not.toContain('%');
  });

  it('renders green bar for value < 60', () => {
    const { container } = render(<ResourceBar value={30} />);
    const bar = container.querySelector('.bg-green-500');
    expect(bar).toBeTruthy();
  });

  it('renders yellow bar for value between 60 and 85', () => {
    const { container } = render(<ResourceBar value={70} />);
    const bar = container.querySelector('.bg-yellow-400');
    expect(bar).toBeTruthy();
  });

  it('renders red bar for value >= 85', () => {
    const { container } = render(<ResourceBar value={90} />);
    const bar = container.querySelector('.bg-red-500');
    expect(bar).toBeTruthy();
  });

  it('renders red bar at exactly 85', () => {
    const { container } = render(<ResourceBar value={85} />);
    const bar = container.querySelector('.bg-red-500');
    expect(bar).toBeTruthy();
  });

  it('renders without label or value when neither provided', () => {
    const { container } = render(<ResourceBar value={50} showValue={false} />);
    const progressBar = container.querySelector('.h-1\\.5');
    expect(progressBar).toBeTruthy();
  });
});
