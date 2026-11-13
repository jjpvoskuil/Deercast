import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BUILD = when this copy was built (shown under More and in the menu, to check the phone has the latest version)
const now = new Date();
const BUILD = now.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const BUILD_ID = now.toISOString();
// version.json next to index.html: the app checks it to offer "Update" when a newer build is published (lib/update.js)
const versionFile = () => ({
  name: "deercast-version",
  generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID, label: BUILD }) }); },
});
// BASE = the folder the site is served from: "/Deercast/" on GitHub Pages (set by .github/workflows/pages.yml), "/" elsewhere
export default defineConfig({ base: process.env.BASE || "/", plugins: [react(), versionFile()],
  define: { __BUILD__: JSON.stringify(BUILD), __BUILD_ID__: JSON.stringify(BUILD_ID) } });
