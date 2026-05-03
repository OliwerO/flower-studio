/** @type {import('tailwindcss').Config} */
export default {
  // Include the shared package so Tailwind's content scan picks up classes
  // used ONLY inside shared components. Without this glob, classes that
  // never appear in this app's own src/ get purged from production CSS.
  content: ['./index.html', './src/**/*.{js,jsx}', '../../packages/shared/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#fdf2f8',
          100: '#fce7f3',
          200: '#fbcfe8',
          300: '#f9a8d4',
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
          700: '#be185d',
          800: '#9d174d',
          900: '#831843',
        },
        ios: {
          bg:       '#F2F2F7',
          card:     '#FFFFFF',
          label:    '#000000',
          secondary:'#3C3C43',
          tertiary: '#8E8E93',
          separator:'#C6C6C8',
          blue:     '#007AFF',
          green:    '#34C759',
          red:      '#FF3B30',
          orange:   '#FF9500',
          fill:     '#F2F2F7',
          fill2:    '#E5E5EA',
        },
      },
    },
  },
  plugins: [],
};
