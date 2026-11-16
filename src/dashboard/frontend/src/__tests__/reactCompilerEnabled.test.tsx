/**
 * PAN-4561: proves the frontend Vitest suite runs React Compiler output, so it
 * tests what the build ships. Without the compiler, every click re-renders
 * <Child>; with it, Parent caches the constant <Child> element and Child
 * renders once.
 */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const renders: string[] = [];
const record = (label: string) => { renders.push(label); };

function Child({ label, onRender }: { label: string; onRender: (l: string) => void }) {
  onRender(label);
  return <span>{label}</span>;
}

function Parent() {
  const [n, setN] = useState(0);
  return (
    <div>
      <button onClick={() => setN(n + 1)}>{n}</button>
      <Child label="static" onRender={record} />
    </div>
  );
}

describe('React Compiler under Vitest', () => {
  it('compiles components under Vitest: a constant child element is not re-rendered', () => {
    render(<Parent />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('3');
    expect(renders).toHaveLength(1); // 4 without the compiler
  });
});
