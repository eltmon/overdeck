import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../../lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'link';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading = false, className, children, disabled, ...props }, ref) => {
    const baseStyles = 'font-bold transition-all rounded-lg focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed';

    const variantStyles = {
      primary: 'bg-[#a078f7] text-white px-6 py-2 hover:bg-[#a078f7]/90 shadow-lg shadow-[#a078f7]/20 focus:ring-[#a078f7]',
      secondary: 'text-[#a390cb] px-4 py-2 hover:text-white focus:ring-[#a390cb]',
      link: 'text-[#a390cb] text-sm hover:text-white underline px-0 py-0',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {children}
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
