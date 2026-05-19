import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 0 32px rgba(45, 212, 191, 0.32)",
        hud: "0 16px 50px rgba(0, 0, 0, 0.35)"
      }
    }
  },
  plugins: []
};

export default config;
