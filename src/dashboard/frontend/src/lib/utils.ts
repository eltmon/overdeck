/**
 * Utility for merging Tailwind CSS classnames
 * Similar to clsx + tailwind-merge
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(' ');
}
