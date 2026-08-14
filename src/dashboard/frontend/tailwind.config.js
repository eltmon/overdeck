/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // display-xl/display-lg/eyebrow are authored in src/index.css's
  // `@layer components` but not yet consumed by any .tsx file (PAN-3410
  // theme-token-scope lands the vocabulary; broadsheet-mechanical-migration
  // adopts it). Without a safelist entry Tailwind's content-based purge drops
  // them from the build since no scanned file contains the class name token.
  // chip/chip-dashed/chip-selected/soft-card/soft-card-bordered/large-cta/
  // keycap/dot-metadata (PAN-3706 F-11) and shadow-floating/shadow-overlay
  // (PAN-3706 F-4) are the same situation: authored, not yet consumed.
  // shadow-card is already referenced (SimpleQuestionCard.tsx) so it would
  // survive the scan on its own, but it's listed too for clarity/parity with
  // its shadow-floating/shadow-overlay siblings.
  safelist: [
    'display-xl',
    'display-lg',
    'eyebrow',
    'chip',
    'chip-dashed',
    'chip-selected',
    'soft-card',
    'soft-card-bordered',
    'large-cta',
    'keycap',
    'dot-metadata',
    'shadow-card',
    'shadow-floating',
    'shadow-overlay',
  ],
  theme: {
    extend: {
      colors: {
        // ─── Semantic tokens ───
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        // ─── Signal colors ───
        info: {
          DEFAULT: 'var(--info)',
          foreground: 'var(--info-foreground)',
        },
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          foreground: 'var(--warning-foreground)',
        },
        'signal-review': {
          DEFAULT: 'var(--signal-review)',
          foreground: 'var(--signal-review-foreground)',
        },
        'signal-cost': {
          DEFAULT: 'var(--signal-cost)',
          foreground: 'var(--signal-cost-foreground)',
        },
        // PAN-3706 F-8/F-5 — new tokens that need a Tailwind color entry so
        // components can actually reach them (text-primary-ink,
        // text-body-foreground, text-faint-foreground, bg-wash, ...).
        'primary-ink': 'var(--primary-ink)',
        'body-foreground': 'var(--body-foreground)',
        'faint-foreground': 'var(--faint-foreground)',
        wash: 'var(--wash)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"SF Mono"', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
        // PAN-3706 F-10 — chrome/UI monospace role, split out from `mono`
        // (reserved for code/terminal output). Fallback stack mirrors the
        // `mono` entry's own convention: repeat the CSS variable's Ledger
        // fallback stack so the generated class still degrades sanely if
        // the custom property is ever unavailable.
        'mono-ui': ['var(--font-mono-ui)', '"SF Mono"', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        '3xl': 'calc(var(--radius) + 12px)',
        '4xl': 'calc(var(--radius) + 16px)',
      },
      // PAN-3706 F-4 — role-named, dark-mode-aware shadow scale. sm/md/lg/xl
      // override Tailwind's stock boxShadow keys (theme.extend deep-merges
      // per named key, same mechanism borderRadius above already relies on
      // to fully override Tailwind's stock radius scale); card/floating/
      // overlay are new keys. Every value is var(--shadow-*, <stock-or-new
      // literal fallback>) — same var()-with-literal-fallback shape
      // index.css already uses for --badge-radius. --shadow-* is always
      // defined (see index.css's :root and the four data-theme scopes), so
      // the fallback here is defense-in-depth, not the primary path.
      boxShadow: {
        sm: 'var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05))',
        md: 'var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1))',
        lg: 'var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1))',
        xl: 'var(--shadow-xl, 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1))',
        card: 'var(--shadow-card, 0 1px 1px rgba(0, 0, 0, 0.05))',
        floating: 'var(--shadow-floating, 0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08))',
        overlay: 'var(--shadow-overlay, 0 16px 48px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.1))',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'slide-down-banner': {
          '0%': {
            maxHeight: '0',
            opacity: '0',
            paddingTop: '0',
            paddingBottom: '0',
            borderBottomWidth: '0',
          },
          '100%': {
            maxHeight: '4rem',
            opacity: '1',
            paddingTop: '0.75rem',
            paddingBottom: '0.75rem',
            borderBottomWidth: '2px',
          },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
        'slide-out-right': 'slide-out-right 0.2s ease-in',
        'slide-down-banner': 'slide-down-banner 0.25s ease-out',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
};
