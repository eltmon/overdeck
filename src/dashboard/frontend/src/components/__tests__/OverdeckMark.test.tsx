import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { OverdeckMark } from '../OverdeckMark';

function svgOf(container: HTMLElement): SVGSVGElement {
  return container.querySelector('svg') as SVGSVGElement;
}

function finishLap(svg: SVGSVGElement) {
  fireEvent.animationIteration(svg);
}

describe('OverdeckMark', () => {
  it('sits still by default', () => {
    const { container } = render(<OverdeckMark />);
    expect(svgOf(container).getAttribute('class')).not.toContain('animate-');
    expect(svgOf(container).dataset.orbiting).toBeUndefined();
  });

  it('orbits while busy, only under motion-safe', () => {
    const { container } = render(<OverdeckMark className="w-5 h-5" orbiting />);
    expect(svgOf(container).getAttribute('class')).toContain('motion-safe:animate-[spin_6s_linear_infinite]');
    expect(svgOf(container).dataset.orbiting).toBe('true');
  });

  it('finishes the current lap before stopping so the satellite lands at rest', () => {
    const { container, rerender } = render(<OverdeckMark orbiting />);
    rerender(<OverdeckMark orbiting={false} />);
    expect(svgOf(container).dataset.orbiting).toBe('true');

    finishLap(svgOf(container));
    expect(svgOf(container).dataset.orbiting).toBeUndefined();
  });

  it('keeps orbiting through a lap boundary while still busy', () => {
    const { container } = render(<OverdeckMark orbiting />);
    finishLap(svgOf(container));
    expect(svgOf(container).dataset.orbiting).toBe('true');
  });
});
