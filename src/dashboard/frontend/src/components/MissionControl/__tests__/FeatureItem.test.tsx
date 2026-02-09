/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureItem } from '../ProjectTree/FeatureItem';

// Mock CSS module
vi.mock('../styles/mission-control.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => `mock-${String(prop)}`,
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Loader2: ({ size, className, style }: any) => (
    <span data-testid="icon-loader" className={className} style={style}>Loader</span>
  ),
  AlertTriangle: ({ size, style }: any) => (
    <span data-testid="icon-alert" style={style}>Alert</span>
  ),
  CheckCircle2: ({ size, style }: any) => (
    <span data-testid="icon-check" style={style}>Check</span>
  ),
  Circle: ({ size, style }: any) => (
    <span data-testid="icon-circle" style={style}>Circle</span>
  ),
  Eye: ({ size, style }: any) => (
    <span data-testid="icon-eye" style={style}>Eye</span>
  ),
}));

function makeFeature(overrides = {}) {
  return {
    issueId: 'PAN-123',
    title: 'Test Feature',
    branch: 'feature/pan-123',
    status: 'idle',
    stateLabel: 'Idle',
    agentStatus: null as string | null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    ...overrides,
  };
}

describe('FeatureItem', () => {
  it('should render issue ID', () => {
    render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} />);
    // Issue ID appears in both featureId_sidebar and featureLabel (when no title)
    expect(screen.getAllByText('PAN-123').length).toBeGreaterThanOrEqual(1);
  });

  it('should render custom title when provided', () => {
    render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} title="My Custom Title" />);
    expect(screen.getByText('My Custom Title')).toBeTruthy();
  });

  it('should fall back to issueId when no title', () => {
    const { container } = render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} />);
    // Both the featureId_sidebar and featureLabel should show the ID
    const labels = container.querySelectorAll('.mock-featureLabel');
    expect(labels[0]?.textContent).toBe('PAN-123');
  });

  it('should render state label', () => {
    render(<FeatureItem feature={makeFeature({ stateLabel: 'In Progress' })} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByText('In Progress')).toBeTruthy();
  });

  it('should show cost when provided', () => {
    render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} cost={3.45} />);
    expect(screen.getByText('$3.45')).toBeTruthy();
  });

  it('should format small costs correctly', () => {
    render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} cost={0.005} />);
    expect(screen.getByText('<$0.01')).toBeTruthy();
  });

  it('should not show cost when zero', () => {
    const { container } = render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} cost={0} />);
    expect(container.querySelector('.mock-featureCost')).toBeNull();
  });

  it('should not show cost when undefined', () => {
    const { container } = render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} />);
    expect(container.querySelector('.mock-featureCost')).toBeNull();
  });

  it('should call onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={onSelect} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('should apply selected class when isSelected is true', () => {
    const { container } = render(<FeatureItem feature={makeFeature()} isSelected={true} onSelect={() => {}} />);
    expect(container.querySelector('.mock-featureItemSelected')).toBeTruthy();
  });

  it('should not apply selected class when isSelected is false', () => {
    const { container } = render(<FeatureItem feature={makeFeature()} isSelected={false} onSelect={() => {}} />);
    expect(container.querySelector('.mock-featureItemSelected')).toBeNull();
  });

  // Status icon tests
  it('should show spinner for running status', () => {
    render(<FeatureItem feature={makeFeature({ status: 'running' })} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('icon-loader')).toBeTruthy();
  });

  it('should show alert triangle for suspended agent', () => {
    render(<FeatureItem feature={makeFeature({ agentStatus: 'suspended' })} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('icon-alert')).toBeTruthy();
  });

  it('should show check icon for has_state status', () => {
    render(<FeatureItem feature={makeFeature({ status: 'has_state' })} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });

  it('should show circle icon for idle status', () => {
    render(<FeatureItem feature={makeFeature({ status: 'idle' })} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('icon-circle')).toBeTruthy();
  });

  it('should show eye icon for shadow engineering features', () => {
    render(<FeatureItem feature={makeFeature({ isShadow: true })} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('icon-eye')).toBeTruthy();
  });

  // State labels
  it('should render all possible state labels', () => {
    const labels = ['Idle', 'In Progress', 'Done', 'In Review', 'Suspended', 'Planning', 'Has Context'];
    for (const label of labels) {
      const { unmount } = render(
        <FeatureItem feature={makeFeature({ stateLabel: label })} isSelected={false} onSelect={() => {}} />
      );
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });
});
