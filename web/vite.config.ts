import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Adds a CSP meta tag; inline scripts are allowed by the hash of their exact emitted text. */
export function withCsp(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    // browsers normalise CRLF to LF before hashing, so hash what they will see
    (m) => `'sha256-${createHash("sha256").update(m[1].replace(/\r\n?/g, "\n")).digest("base64")}'`,
  );
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' wss://ws.finnhub.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  return html.replace(/(<meta charset="UTF-8" \/>)/, `$1\n    ${meta}`);
}

/**
 * Production-only Content Security Policy: the only network peers are Google Fonts and - for the
 * opt-in live mode - Finnhub's WebSocket. Runs last ("post") so the hashes match the emitted HTML.
 */
function csp(): Plugin {
  return { name: "atlas-csp", apply: "build", transformIndexHtml: { order: "post", handler: withCsp } };
}

// Relative base so the static build works at any GitHub Pages sub-path (HashRouter handles routes).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), csp()],
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/node_modules[\\/](@tanstack|zustand)[\\/]/.test(id)) return "query";
          return undefined;
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
