/** @type {import('tailwindcss').Config} */
export default {
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
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
