import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourcesGroup } from './ResourcesGroup';
import type { ContainerNodeProps } from './ContainerNode';

function makeContainer(overrides?: Partial<ContainerNodeProps>): ContainerNodeProps {
  return {
    name: 'pan-821-db',
    serviceName: 'db',
    status: 'running',
    cpuPercent: 4,
    memoryUsage: 1024 * 1024 * 64,
    ...overrides,
  };
}

describe('ResourcesGroup', () => {
  it('renders header Containers and one row per container', () => {
    const { container } = render(
      <ResourcesGroup
        issueId="PAN-821"
        containers={[makeContainer({ name: 'pan-821-db', serviceName: 'db' }), makeContainer({ name: 'pan-821-api', serviceName: 'api' })]}
        defaultExpanded
      />,
    );

    expect(screen.getByText('Containers')).toBeInTheDocument();
    expect(screen.getByText('2 containers')).toBeInTheDocument();
    expect(screen.getByText('db')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(container.querySelectorAll('[title="pan-821-db"], [title="pan-821-api"]')).toHaveLength(2);
  });

  it('renders nothing with zero containers', () => {
    const { container } = render(<ResourcesGroup issueId="PAN-821" containers={[]} defaultExpanded />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders no branch or PR text — the group is containers-only', () => {
    render(
      <ResourcesGroup
        issueId="PAN-821"
        containers={[makeContainer()]}
        defaultExpanded
      />,
    );

    expect(screen.queryByText(/\(local\)/)).toBeNull();
    expect(screen.queryByText(/\(remote\)/)).toBeNull();
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
  });
});
