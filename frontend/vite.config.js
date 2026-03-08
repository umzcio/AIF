import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/aif/",
  server: {
    proxy: {
      "/aif/api": "http://localhost:3000",
    },
  },
});
