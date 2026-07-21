import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AwaitingInputIndicator } from '../AwaitingInputIndicator';
import { PENDING_INPUT_KIND_LABEL } from '../../lib/pendingInput';

describe('AwaitingInputIndicator', () => {
  it('pulses when it is a plain indicator', () => {
    const { container } = render(<AwaitingInputIndicator kinds={['askUserQuestion']} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  /**
   * The clickable variant used to drop the pulse, which meant the one indicator
   * the operator most needs to notice — the one they can act on — was the only
   * one that sat still.
   */
  it('pulses when it is clickable', () => {
    const { container } = render(
      <AwaitingInputIndicator kinds={['askUserQuestion']} onClick={() => {}} />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders as a button and invokes onClick to re-open the dialog', async () => {
    const onClick = vi.fn();
    render(<AwaitingInputIndicator kinds={['askUserQuestion']} onClick={onClick} />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not bubble the click to a clickable parent row', async () => {
    const onClick = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <AwaitingInputIndicator kinds={['askUserQuestion']} onClick={onClick} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('names the waiting kind and the action in its accessible label', () => {
    render(<AwaitingInputIndicator kinds={['askUserQuestion']} onClick={() => {}} />);
    expect(
      screen.getByRole('button', {
        name: `${PENDING_INPUT_KIND_LABEL.askUserQuestion} — click to answer`,
      }),
    ).toBeTruthy();
  });

  it('renders a non-interactive element when there is nothing to re-open', () => {
    render(<AwaitingInputIndicator kinds={['askUserQuestion']} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
