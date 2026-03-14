/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
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
          bg:       '#F2F2F7',   // iOS systemGroupedBackground
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
        dark: {
          bg:       '#1C1C1E',
          card:     '#2C2C2E',
          elevated: '#3A3A3C',
          label:    '#FFFFFF',
          secondary:'#EBEBF5',
          tertiary: '#636366',
          separator:'#38383A',
        },
      },
    },
  },
  plugins: [],
};
