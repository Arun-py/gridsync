/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Carried forward from the original GridSync palette (sky/cyan family) */
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        /* Control-room neutrals: deep, slightly cool, low chroma */
        panel: {
          950: '#080b11',
          900: '#0c1017',
          850: '#11161f',
          800: '#161c27',
          700: '#1e2531',
          600: '#2a3342',
          500: '#3b4657',
        },
        /* Domain accents — one per subsystem, used consistently everywhere */
        solar: '#f5a524',
        battery: '#22c55e',
        acload: '#38bdf8',
        dcload: '#a78bfa',
        /* Severity — deliberately distinct from domain accents */
        severity: {
          info: '#38bdf8',
          warning: '#f59e0b',
          critical: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flow-dash': 'flow-dash 1s linear infinite',
        'fade-in': 'fade-in 200ms ease-out',
        'slide-in': 'slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'flow-dash': {
          to: { strokeDashoffset: '-16' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
