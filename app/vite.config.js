import { defineConfig } from "vite";
import { createVuePlugin } from "vite-plugin-vue2";
import path from "path";

export default defineConfig({
  plugins: [createVuePlugin()],
  server: {
    port: 8088
  },
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "src")
      }
    ]
  },
  build: {
    chunkSizeWarningLimit: 600,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "./src/main.js"),
      name: "MyLib"
    }
  }
});
