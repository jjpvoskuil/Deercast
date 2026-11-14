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

// More → "Tap test": shows where the phone says each touch landed (to find iPhone touch offsets)
window.__tapTest = (on) => {
  if (window.__tapOff) { window.__tapOff(); window.__tapOff = null; }
  if (!on) return;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:8px;right:8px;top:40%;z-index:9999;background:#000c;color:#fff;font:14px/1.4 system-ui;padding:8px 10px;border-radius:10px;pointer-events:none";
  box.textContent = "Tap test on — tap the middle of a tab bar icon.";
  document.body.appendChild(box);
  const f = (e) => {
    const t = e.changedTouches?.[0] || e;
    const dot = document.createElement("div");
    dot.style.cssText = `position:fixed;left:${t.clientX - 9}px;top:${t.clientY - 9}px;width:18px;height:18px;border-radius:50%;background:#e5372b;z-index:9999;pointer-events:none;box-shadow:0 0 0 2px #fff`;
    document.body.appendChild(dot); setTimeout(() => dot.remove(), 2500);
    const bar = document.querySelector(".tabbar")?.getBoundingClientRect();
    const hit = document.elementFromPoint(t.clientX, t.clientY);
    const vv = window.visualViewport, i = window.__screenInfo?.() || {};
    box.textContent = `${e.type}: y ${Math.round(t.clientY)} (screen ${Math.round(t.screenY ?? 0)}) · page height ${innerHeight} · view ${vv ? `${Math.round(vv.height)} @${Math.round(vv.offsetTop)}` : "-"} · scroll ${Math.round(scrollY)} · safe top ${i.top} · resets ${window.__vpResets}${window.__vpLast ? ` (last ${window.__vpLast.why} ${window.__vpLast.at}, off ${window.__vpLast.off})` : ""} · tab bar ${bar ? `${Math.round(bar.top)}–${Math.round(bar.bottom)}` : "—"} · hit: ${hit?.closest(".tabbar button")?.innerText || hit?.tagName || "nothing"}`;
  };
  document.addEventListener("touchstart", f, true);
  document.addEventListener("click", f, true);
  window.__tapOff = () => { document.removeEventListener("touchstart", f, true); document.removeEventListener("click", f, true); box.remove(); };
};
// iPhone home-screen app bug (11-14): mid-sit, the page got drawn ~62 px (the status-bar height) away from where taps
// land — everywhere, not just the tab bar — until the app was closed and reopened. It follows things that move the
// page under the hood: the keyboard or time picker closing, a location prompt / GPS starting, coming back to the app.
// After each of those, put the page back at the top and make WebKit lay it out again (what reopening does).
const IOS_APP = /iPhone|iPad|iPod/.test(navigator.userAgent) && (navigator.standalone || matchMedia("(display-mode: standalone)").matches);
window.__vpResets = 0;
let vpTimer = null;
function resetViewport(why) {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // the keyboard is still up: leave it alone
  const se = document.scrollingElement || document.documentElement, vv = window.visualViewport;
  const off = Math.round(scrollY || se.scrollTop || document.body.scrollTop || (vv ? vv.offsetTop : 0) || 0);
  if (off) { scrollTo(0, 0); se.scrollTop = 0; document.body.scrollTop = 0; }
  // force a fresh layout + paint of the whole app: a 1-frame height change WebKit can't skip
  const root = document.documentElement;
  root.style.minHeight = "calc(100% + 1px)";
  void root.offsetHeight;
  requestAnimationFrame(() => { root.style.minHeight = ""; void root.offsetHeight; measureGap(); });
  window.__vpResets += 1;
  window.__vpLast = { why, off, at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
}
// run twice: right away and after iOS finishes its own animation (keyboard / prompt closing)
window.__vpReset = (why = "app") => {
  if (!IOS_APP) return;
  clearTimeout(vpTimer);
  setTimeout(() => resetViewport(why), 60);
  vpTimer = setTimeout(() => resetViewport(why), 450);
};
if (IOS_APP) {
  document.addEventListener("focusout", () => window.__vpReset("keyboard"));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && window.__vpReset("back to app"));
  addEventListener("pageshow", () => window.__vpReset("opened"));
  addEventListener("focus", () => window.__vpReset("focus"));
  window.visualViewport?.addEventListener("resize", () => window.__vpReset("view size"));
}
addEventListener("resize", measureGap);
addEventListener("orientationchange", () => setTimeout(measureGap, 300));

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
