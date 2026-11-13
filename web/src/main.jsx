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
  // 11-13: moving the tab bar down by the gap made it disappear on John's iPhone (iOS won't draw fixed things below the
  // page it thinks it has), so the gap is only measured and shown under More (screen info) — not applied — for now.
  if (gap >= 0 && gap <= 200) window.__iosGap = gap;
}
measureGap();
addEventListener("resize", measureGap);
addEventListener("orientationchange", () => setTimeout(measureGap, 300));

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
