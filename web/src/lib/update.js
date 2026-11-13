// "A new version is out": compare this copy's build id with version.json on the server (written by vite.config.js).
import { useEffect, useState } from "react";

const MINE = typeof __BUILD_ID__ === "undefined" ? null : __BUILD_ID__;
const EVERY_MS = 5 * 60e3;

export function useUpdate() {
  const [next, setNext] = useState(null); // { id, label } of a newer build
  useEffect(() => {
    if (!MINE) return;
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 30e3) return;
      last = Date.now();
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
        const v = await r.json();
        if (v?.id && v.id > MINE) setNext(v);
      } catch { /* offline: try later */ }
    };
    check();
    const i = setInterval(check, EVERY_MS);
    const vis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return next;
}

/** Load the newest copy: a fresh address skips the phone's cached page (GitHub Pages caches it ~10 min). */
export function applyUpdate(next) {
  const q = new URLSearchParams(location.search);
  q.set("v", (next?.id || String(Date.now())).replace(/\D/g, "").slice(0, 14));
  location.replace(`${location.pathname}?${q}${location.hash}`);
}
