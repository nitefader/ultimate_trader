/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          900: '#0c4a6e',
        },
        danger: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
        paper: '#818cf8',
        live: '#f87171',
        backtest: '#34d399',
      },
    },
  },
  plugins: [],
}
