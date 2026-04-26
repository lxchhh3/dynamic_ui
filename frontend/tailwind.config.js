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
        skin: {
          bg: '#F5EFE6',
          surface: '#ECE0CE',
          'surface-2': '#E0CFB8',
          border: '#D8C7B0',
          ink: '#4A3728',
          muted: '#8A7A66',
          accent: '#D89B7A',
          'accent-deep': '#B97A58',
          success: '#8B9D5A',
          danger: '#C9543E',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(34, 197, 94, 0.45)',
        glowRed: '0 0 24px rgba(239, 68, 68, 0.45)',
        sheet: '0 24px 64px -12px rgba(74, 55, 40, 0.25)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
