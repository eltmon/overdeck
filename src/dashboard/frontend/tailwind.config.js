/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'status-healthy': '#22c55e',
        'status-warning': '#eab308',
        'status-stuck': '#f97316',
        'status-dead': '#ef4444',
        surface: {
          DEFAULT: 'rgb(var(--color-base) / <alpha-value>)',
          raised: 'rgb(var(--color-raised) / <alpha-value>)',
          overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
          emphasis: 'rgb(var(--color-emphasis) / <alpha-value>)',
        },
        content: {
          DEFAULT: 'rgb(var(--color-heading) / <alpha-value>)',
          body: 'rgb(var(--color-body) / <alpha-value>)',
          subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
          muted: 'rgb(var(--color-muted) / <alpha-value>)',
        },
        divider: {
          DEFAULT: 'rgb(var(--color-divider) / <alpha-value>)',
          strong: 'rgb(var(--color-divider-strong) / <alpha-value>)',
        },
        'input-bg': 'rgb(var(--color-input-bg) / <alpha-value>)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
