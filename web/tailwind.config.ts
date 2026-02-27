import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef9ec",
          100: "#fdf0c9",
          200: "#fae08f",
          300: "#f7cc54",
          400: "#f4b831",
          500: "#ee9b12",
          600: "#d3780c",
          700: "#af570d",
          800: "#8e4411",
          900: "#753912",
          950: "#431d06",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
