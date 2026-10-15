import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [react(), tailwindcss()],
	build: { outDir: "dist" },
	server: {
		// Plain string target keeps http-proxy streaming, which is SSE-safe.
		proxy: {
			"/api": "http://127.0.0.1:5511",
		},
	},
});
