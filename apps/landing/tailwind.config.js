/** @type {import('tailwindcss').Config} */
// Palette + tokens mirror apps/web exactly so the landing reads as one family with the app.
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // `sm` realigned to 768px to match the app's de facto "wider than phone" breakpoint.
      screens: {
        sm: '768px',
      },
      colors: {
        ink: '#0A2540',
        teal: {
          DEFAULT: '#00E5C0',
          50: '#E6FBF6',
          400: '#33ECCC',
          500: '#00E5C0',
          600: '#00B89B',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#ef4444',
        ink900: '#1F2937',
        fog: '#F4F7FA',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        modal: '16px',
      },
    },
  },
  plugins: [],
};
