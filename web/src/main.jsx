import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";

// iPhone home-screen app bug: the page comes out shorter than the screen (see --ios-gap in styles.css). Measure it.
function measureGap() {
  window.__screenInfo = () => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);visibility:hidden";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe), info = { screen: `${screen.width}×${screen.height}`, inner: `${innerWidth}×${innerHeight}`,
      vv: window.visualViewport ? Math.round(visualViewport.height) : "-", top: cs.paddingTop, bottom: cs.paddingBottom,
      standalone: !!(navigator.standalone || matchMedia("(display-mode: standalone)").matches) };
    probe.remove();
    return info;
  };
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (!standalone || !/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
  const portrait = innerHeight > innerWidth;
  const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const gap = Math.round(screenH - innerHeight);
  // John's iPhone (11-13): screen 874, page 812 — short by the status-bar height (62) with the see-through status bar.
  // Nothing can be drawn in that strip (moving the tab bar there made it vanish). index.html now uses the "default"
  // status bar, which should end the bug; if the phone still has it (old home-screen setting), blend the strip in.
  if (gap >= 0 && gap <= 200) window.__iosGap = gap;
  // the strip below the page can't hold anything, but it shows the page's background: color it like the tab bar so the
  // two read as one bar, and drop the tab bar's own home-indicator padding (the indicator sits in that strip)
  // (only while the page still runs under the status bar: safe top > 0; with the "default" status bar it's 0 and the
  // page ends at the real bottom — the 62 px difference is then just the status bar)
  const safeTop = parseFloat(window.__screenInfo?.().top) || 0;
  document.documentElement.classList.toggle("ios-short", gap > 20 && gap <= 100 && safeTop > 20);
}
measureGap();
addEventListener("resize", measureGap);
addEventListener("orientationchange", () => setTimeout(measureGap, 300));

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
