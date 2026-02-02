/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './dashboard.html',
    './src/**/*.{js,ts,jsx,tsx,css}',
    './public/**/*.html',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        background: {
          start: '#0f0f1a',
          end: '#1a1a2e',
        },
      },
      backgroundImage: {
        'gradient-dark': 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)',
      },
      backdropBlur: {
        card: '10px',
      },
    },
  },
  plugins: [],
};
