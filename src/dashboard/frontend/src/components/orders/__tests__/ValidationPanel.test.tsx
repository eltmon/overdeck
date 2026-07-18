import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ValidationPanel } from '../ValidationPanel';

const block = { code: 'missing-prd', issue: 'PAN-2', message: 'PAN-2 has no draft PRD or canonical spec' };
const warning = { code: 'missing-prd', issue: 'PAN-3', message: 'PAN-3 will be planned at pickup' };

describe('ValidationPanel', () => {
  it('disables Start run and lists every blocking finding', () => {
    const onStart = vi.fn();
    render(<ValidationPanel blocks={[block]} warns={[warning]} onPreview={vi.fn()} onStart={onStart} />);

    expect(screen.getByText(block.message)).toBeInTheDocument();
    expect(screen.getByText(warning.message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start run/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('renders warnings without disabling Start run', () => {
    const onStart = vi.fn();
    render(<ValidationPanel blocks={[]} warns={[warning]} onPreview={vi.fn()} onStart={onStart} />);

    const start = screen.getByRole('button', { name: /Start run/ });
    expect(screen.getByText(warning.message)).toBeInTheDocument();
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledOnce();
  });
});
