import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

type SharedButtonVariant = 'primary' | 'ghost' | 'danger';
type SharedButtonSize = 'sm' | 'md';

type SharedButtonBaseProps = {
  variant?: SharedButtonVariant;
  size?: SharedButtonSize;
  children: ReactNode;
  className?: string;
};

export type SharedButtonProps = SharedButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement>;
export type SharedButtonLinkProps = SharedButtonBaseProps & AnchorHTMLAttributes<HTMLAnchorElement>;

const BASE_CLASSES = 'inline-flex items-center justify-center rounded-[var(--radius-sm)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45';

const SIZE_CLASSES: Record<SharedButtonSize, string> = {
  sm: 'px-[12px] py-[7px] text-[12px]',
  md: 'px-[14px] py-[8px] text-[13px]',
};

const VARIANT_CLASSES: Record<SharedButtonVariant, string> = {
  primary: 'border border-primary/70 bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-primary/90',
  ghost: 'border border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
  danger: 'border border-destructive/70 bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-destructive/90',
};

const VARIANT_STYLES: Partial<Record<SharedButtonVariant, CSSProperties>> = {
  primary: { boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)' },
  danger: { boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)' },
};

export const Button = forwardRef<HTMLButtonElement, SharedButtonProps>(
  ({ variant = 'primary', size = 'sm', className, type = 'button', style, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-component="shared-button"
      data-variant={variant}
      className={cn(BASE_CLASSES, SIZE_CLASSES[size], VARIANT_CLASSES[variant], className)}
      style={{ ...VARIANT_STYLES[variant], ...style }}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export const ButtonLink = forwardRef<HTMLAnchorElement, SharedButtonLinkProps>(
  ({ variant = 'ghost', size = 'sm', className, style, ...props }, ref) => (
    <a
      ref={ref}
      data-component="shared-button"
      data-variant={variant}
      className={cn(BASE_CLASSES, SIZE_CLASSES[size], VARIANT_CLASSES[variant], className)}
      style={{ ...VARIANT_STYLES[variant], ...style }}
      {...props}
    />
  ),
);
ButtonLink.displayName = 'ButtonLink';

export default Button;
