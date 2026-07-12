/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // App style requirements
        background: '#0B0F19',
        'bg-secondary': '#111827',
        card: '#1F2937',
        primary: '#3B82F6',
        secondary: '#06B6D4',
        'text-main': '#F9FAFB',
        'text-muted': '#9CA3AF',
        'border-dark': '#243041',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'neon-blue': '0 0 15px rgba(59, 130, 246, 0.15)',
        'neon-cyan': '0 0 15px rgba(6, 182, 212, 0.15)',
        'neon-glow': '0 0 20px rgba(6, 182, 212, 0.1) , 0 0 40px rgba(59, 130, 246, 0.05)',
      },
    },
  },
  plugins: [],
}
