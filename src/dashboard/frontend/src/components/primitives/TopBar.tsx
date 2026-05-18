import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

type TopBarProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  className?: string;
};

export default function TopBar({ title, eyebrow, right, className }: TopBarProps) {
  return (
    <header
      data-component="top-bar"
      className={cn(
        'flex h-[52px] shrink-0 items-center gap-[12px] border-b border-border bg-background px-[22px]',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-[4px] truncate text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="truncate text-[18px] font-semibold leading-none text-foreground">{title}</h1>
      </div>
      {right && <div className="ml-auto min-w-0">{right}</div>}
    </header>
  );
}
