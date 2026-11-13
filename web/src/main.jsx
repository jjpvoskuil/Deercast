import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";

// iPhone home-screen app bug: the page comes out shorter than the screen (see --ios-gap in styles.css). Measure it.
function measureGap() {
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (!standalone || !/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
  const portrait = innerHeight > innerWidth;
  const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const gap = Math.round(screenH - innerHeight);
  if (gap >= 0 && gap <= 100) document.documentElement.style.setProperty("--ios-gap", `${gap}px`); // bigger = keyboard open: keep the last value
}
measureGap();
addEventListener("resize", measureGap);
addEventListener("orientationchange", () => setTimeout(measureGap, 300));

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
