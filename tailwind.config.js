/**
 * Colour tokens below resolve through CSS custom properties (defined in
 * src/index.css for both the dark default and the `.light` override) rather
 * than literal hex, so a single class toggle on <html> repaints the whole
 * app — no per-component dark:/light: variants needed. See withOpacity().
 */
function withOpacity(variable) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `rgb(var(${variable}))` : `rgb(var(${variable}) / ${opacityValue})`;
}

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
        /* Control-room neutrals: deep, slightly cool, low chroma (dark theme) —
           become light neutrals under `.light`, via CSS variables. */
        panel: {
          950: withOpacity('--c-panel-950'),
          900: withOpacity('--c-panel-900'),
          850: withOpacity('--c-panel-850'),
          800: withOpacity('--c-panel-800'),
          700: withOpacity('--c-panel-700'),
          600: withOpacity('--c-panel-600'),
          500: withOpacity('--c-panel-500'),
        },
        /* Text/border neutrals — overrides Tailwind's default slate scale so
           every existing text-slate and border-slate class stays theme-aware. */
        slate: {
          50: withOpacity('--c-slate-50'),
          100: withOpacity('--c-slate-100'),
          200: withOpacity('--c-slate-200'),
          300: withOpacity('--c-slate-300'),
          400: withOpacity('--c-slate-400'),
          500: withOpacity('--c-slate-500'),
          600: withOpacity('--c-slate-600'),
          700: withOpacity('--c-slate-700'),
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
