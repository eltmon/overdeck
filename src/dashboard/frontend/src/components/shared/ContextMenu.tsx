import * as Primitive from '@radix-ui/react-context-menu';
import { ChevronRight, Check } from 'lucide-react';

export const ContextMenuRoot = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuPortal = Primitive.Portal;

export function ContextMenuContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        className={`z-[1000] min-w-[168px] overflow-hidden rounded-md border border-border bg-card p-1 shadow-lg ${className}`}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <Primitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className="relative flex cursor-pointer select-none items-center rounded px-3 py-1.5 text-xs text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
    >
      {children}
    </Primitive.Item>
  );
}

export function ContextMenuDestructiveItem({
  children,
  onSelect,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <Primitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className="relative flex cursor-pointer select-none items-center rounded px-3 py-1.5 text-xs text-destructive outline-none transition-colors data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
    >
      {children}
    </Primitive.Item>
  );
}

export function ContextMenuSeparator() {
  return <Primitive.Separator className="my-1 h-px bg-border mx-1" />;
}

export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <Primitive.Label className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </Primitive.Label>
  );
}

export function ContextMenuSub({ children }: { children: React.ReactNode }) {
  return <Primitive.Sub>{children}</Primitive.Sub>;
}

export function ContextMenuSubTrigger({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Primitive.SubTrigger
      disabled={disabled}
      className="relative flex cursor-pointer select-none items-center justify-between rounded px-3 py-1.5 text-xs text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
    >
      <span className="flex-1">{children}</span>
      <ChevronRight size={11} className="ml-2 shrink-0 opacity-50" />
    </Primitive.SubTrigger>
  );
}

export function ContextMenuSubContent({ children }: { children: React.ReactNode }) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        sideOffset={2}
        alignOffset={-4}
        className="z-[1001] min-w-[180px] max-h-[320px] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-card p-1 shadow-lg"
      >
        {children}
      </Primitive.SubContent>
    </Primitive.Portal>
  );
}

export function ContextMenuCheckItem({
  children,
  checked,
  onSelect,
}: {
  children: React.ReactNode;
  checked?: boolean;
  onSelect?: () => void;
}) {
  return (
    <Primitive.CheckboxItem
      checked={checked}
      onSelect={onSelect}
      className="relative flex cursor-pointer select-none items-center rounded pl-7 pr-3 py-1.5 text-xs text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
    >
      <Primitive.ItemIndicator className="absolute left-2 flex items-center justify-center">
        <Check size={11} />
      </Primitive.ItemIndicator>
      {children}
    </Primitive.CheckboxItem>
  );
}
