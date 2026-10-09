import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#14213d", cloud: "#f5f7fb", line: "#e7eaf1", mint: "#dff8ed" } } },
  plugins: [],
};

export default config;
