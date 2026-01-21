import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.server.ts"],
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        chains: resolve(__dirname, "src/chains.ts"),
        actions: resolve(__dirname, "src/actions/index.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "mjs" : "js";
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external: ["viem", "viem/actions"],
      output: {
        preserveModules: false,
      },
    },
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
});
