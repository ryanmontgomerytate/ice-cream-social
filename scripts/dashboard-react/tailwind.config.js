/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Clean, warm palette inspired by heyscoops.com
        cream: {
          50: '#fefdfb',
          100: '#fdf9f3',
          200: '#fbf3e7',
          300: '#f7e9d3',
          400: '#f1d9b3',
          500: '#e9c793',
        },
        coral: {
          50: '#fff5f2',
          100: '#ffe8e0',
          200: '#ffd1c2',
          300: '#ffb89d',
          400: '#ff9e7a',
          500: '#ff8059',
          600: '#ff6239',
          700: '#e54820',
          800: '#c73a15',
        },
        sky: {
          50: '#f0f7ff',
          100: '#e0efff',
          200: '#c1dfff',
          300: '#9dcfff',
          400: '#7ab8ff',
          500: '#5aa7ff',
          600: '#3a96ff',
          700: '#2179e0',
          800: '#1660c2',
        },
        sage: {
          50: '#f4f7f4',
          100: '#e7f0e8',
          200: '#d0e1d1',
          300: '#b3cdb5',
          400: '#9bb69d',
          500: '#7a9d7c',
          600: '#5a845c',
          700: '#466647',
          800: '#344d35',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(400px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
