/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Refined Obsidian & Indigo Palette
        background: '#090B10',
        'bg-secondary': '#0F121C',
        'bg-tertiary': '#151926',
        card: '#131722',
        'card-hover': '#181D2B',
        primary: '#6366F1',
        'primary-hover': '#4F46E5',
        'primary-light': '#818CF8',
        secondary: '#38BDF8',
        'text-main': '#F8FAFC',
        'text-muted': '#94A3B8',
        'text-dim': '#64748B',
        'border-dark': '#1E2435',
        'border-subtle': 'rgba(255, 255, 255, 0.07)',
        'border-hover': 'rgba(255, 255, 255, 0.15)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        heading: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'soft-glow': '0 0 25px rgba(99, 102, 241, 0.15)',
        'neon-blue': '0 0 15px rgba(99, 102, 241, 0.25)',
        'neon-cyan': '0 0 15px rgba(56, 189, 248, 0.2)',
        'card-subtle': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
        'floating': '0 12px 36px -4px rgba(0, 0, 0, 0.6), 0 0 1px 1px rgba(255, 255, 255, 0.08)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
