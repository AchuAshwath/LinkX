import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../node_modules/react-dom"),
      "@tanstack/react-query": path.resolve(
        __dirname,
        "../node_modules/@tanstack/react-query",
      ),
      "@tanstack/react-router": path.resolve(
        __dirname,
        "../node_modules/@tanstack/react-router",
      ),
      "@radix-ui": path.resolve(__dirname, "../node_modules/@radix-ui"),
    },
    dedupe: ["react", "react-dom"],
  },
})
