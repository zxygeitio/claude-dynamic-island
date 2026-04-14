import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // CSS code-splitting: inline small CSS to avoid extra requests
    cssCodeSplit: false,
    // Minify CSS with lightningcss for faster, smaller output
    cssMinify: "lightningcss",
    // Reduce chunk size warnings threshold
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Group Tauri API imports into a shared vendor chunk
        manualChunks(id) {
          if (id.includes("@tauri-apps")) {
            return "tauri-vendor";
          }
        },
      },
    },
  },
});
