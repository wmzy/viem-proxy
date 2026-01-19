import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        chains: resolve(__dirname, "src/chains.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "mjs" : "js";
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external: ["viem"],
      output: {
        preserveModules: false,
      },
    },
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
});
