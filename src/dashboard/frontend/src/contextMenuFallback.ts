export interface ContextMenuFallbackItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ShowContextMenuOptions {
  items: readonly ContextMenuFallbackItem[];
  x: number;
  y: number;
}

let activeCleanup: (() => void) | null = null;

function clampMenuPosition(menu: HTMLDivElement, preferredLeft: number, preferredTop: number): void {
  const rect = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(4, preferredLeft),
    Math.max(4, window.innerWidth - rect.width - 4),
  );
  const top = Math.min(
    Math.max(4, preferredTop),
    Math.max(4, window.innerHeight - rect.height - 4),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function showContextMenu({ items, x, y }: ShowContextMenuOptions): void {
  activeCleanup?.();

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999';
  overlay.dataset.testid = 'context-menu-overlay';

  const menu = document.createElement('div');
  menu.className = 'fixed z-[10000] min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-xl animate-in fade-in zoom-in-95';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.setAttribute('role', 'menu');

  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('mousedown', onMouseDown);
    overlay.remove();
    menu.remove();
    if (activeCleanup === cleanup) activeCleanup = null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup();
    }
  };

  const onMouseDown = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) cleanup();
  };

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.disabled = item.disabled === true;
    button.setAttribute('role', 'menuitem');
    button.className = item.disabled === true
      ? 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground/60 cursor-not-allowed'
      : item.destructive === true
        ? 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-destructive hover:bg-accent cursor-default'
        : 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-popover-foreground hover:bg-accent cursor-default';
    if (item.disabled !== true) {
      button.addEventListener('click', () => {
        cleanup();
        item.onClick();
      });
    }
    menu.appendChild(button);
  }

  activeCleanup = cleanup;
  document.body.appendChild(overlay);
  document.body.appendChild(menu);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousedown', onMouseDown);

  const scheduleFrame = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0));
  scheduleFrame(() => clampMenuPosition(menu, x, y));
}
