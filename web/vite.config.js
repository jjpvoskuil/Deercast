import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BUILD = when this copy was built (shown under More and in the menu, to check the phone has the latest version)
const BUILD = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export default defineConfig({ plugins: [react()], define: { __BUILD__: JSON.stringify(BUILD) } });
