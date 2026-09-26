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
          50: "#fdf4f0",
          100: "#fbe8e0",
          200: "#f7d0c1",
          500: "#e05328",
          600: "#c73e16",
          700: "#a62f10",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
export default config;
