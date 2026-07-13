import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        templateFiller: "template-filler.html",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5182",
        changeOrigin: true,
      },
      "/outputs": {
        target: "http://localhost:5182",
        changeOrigin: true,
      },
    },
  },
});
