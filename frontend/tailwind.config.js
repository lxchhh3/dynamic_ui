/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gate: {
          bg: '#0b0d12',
          surface: '#141821',
          border: '#222836',
          text: '#d7dce5',
          muted: '#7b8597',
          accent: '#6c8cff',
          open: '#22c55e',
          closed: '#6c8cff',
          locked: '#ef4444',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(34, 197, 94, 0.45)',
        glowRed: '0 0 24px rgba(239, 68, 68, 0.45)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
