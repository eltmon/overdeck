/** Shared hover/focus tooltip primitive (PAN-2681 follow-up). Radix-backed so content portals out of clipped or scrolling parents. */
import * as Primitive from '@radix-ui/react-tooltip';

export const TooltipProvider = Primitive.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Wraps an existing focusable trigger. `asChild` keeps the caller's element — no extra button in the tab order. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          sideOffset={5}
          collisionPadding={8}
          className="z-[1000] max-w-[248px] rounded-md border border-border bg-card px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground shadow-lg"
        >
          {content}
          <Primitive.Arrow className="fill-border" width={9} height={4.5} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

interface HelpTooltipProps {
  /** Names the control this explains, so screen readers get "Swarm help" rather than a bare glyph. */
  label: string;
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * An info affordance that carries its own trigger.
 * `data-help-trigger` marks it as skippable for callers that autofocus their first control.
 */
export function HelpTooltip({ label, content, side = 'top' }: HelpTooltipProps) {
  return (
    <Tooltip content={content} side={side}>
      <button
        type="button"
        data-help-trigger=""
        aria-label={`${label} help`}
        className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border border-border text-[8.5px] font-medium leading-none text-muted-foreground hover:border-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <span aria-hidden="true">?</span>
      </button>
    </Tooltip>
  );
}

/** Title + body + per-option glossary, the shape every policy row uses. */
export function TooltipBody({ title, body, options }: { title: string; body: string; options?: Array<[string, string]> }) {
  return (
    <>
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-0.5 text-muted-foreground">{body}</div>
      {options && options.length > 0 && (
        <dl className="mt-1.5 space-y-1 border-t border-border pt-1.5">
          {options.map(([term, meaning]) => (
            <div key={term}>
              <dt className="inline font-medium text-foreground">{term}</dt>
              <dd className="inline text-muted-foreground"> — {meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
