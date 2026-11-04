import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configured } from "./supabase.js";
import MapScreen from "./MapScreen.jsx";
import ForecastScreen from "./ForecastScreen.jsx";
import HuntLogScreen from "./HuntLogScreen.jsx";
import MoreScreen from "./MoreScreen.jsx";
import ShotScreen from "./ShotScreen.jsx";
import { Menu, TabBar } from "./Shell.jsx";
import { demoSeed } from "./demo.js";
import { demoDb, supabaseDb } from "./lib/db.js";
import { resolveTheme } from "./lib/theme.js";

const LAST_GROUND = "deercast.ground";
const THEME_PREF = "deercast.theme";
const HOME = { lat: 37.3006, lon: -86.0608 }; // Cub Run — used until a ground is loaded

/** Light/Soft theme: automatic by sunrise/sunset at the ground, with a manual override. */
function useTheme(place) {
  const [pref, setPrefState] = useState(() => { try { return JSON.parse(localStorage.getItem(THEME_PREF)) || { mode: "auto" }; } catch { return { mode: "auto" }; } });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60e3); return () => clearInterval(t); }, []);
  const info = resolveTheme(pref, place.lat, place.lon, now);
  useEffect(() => {
    document.documentElement.dataset.theme = info.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", info.theme === "dark" ? "#2B2A26" : "#F6F2EB");
  }, [info.theme]);
  const setPref = (p) => { setPrefState(p); try { localStorage.setItem(THEME_PREF, JSON.stringify(p)); } catch { /* ignore */ } };
  return {
    ...info, mode: info.manual ? (pref.until ? "temp" : pref.mode) : "auto",
    flip: () => setPref({ mode: info.theme === "dark" ? "light" : "dark", until: info.next.getTime() }),
    choose: (mode) => setPref(mode === "auto" ? { mode: "auto" } : { mode, until: null }),
  };
}

const TAB_IDS = ["forecast", "map", "log", "shot", "more"];
const BUILT = ["forecast", "map", "log", "shot", "more"];

export default function App() {
  const demo = !configured || new URLSearchParams(location.search).has("demo"); // ?demo = made-up data only
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [me, setMe] = useState(undefined);            // app_users row, null = not approved
  const [grounds, setGrounds] = useState(null);
  const [gid, setGid] = useState(() => localStorage.getItem(LAST_GROUND));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTabState] = useState(() => { const h = location.hash.slice(1).split("/")[0]; return TAB_IDS.includes(h) ? h : "forecast"; });
  const [menu, setMenu] = useState(false);
  const [pin, setPin] = useState(null); // "Forecast this pin" from the map
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);
  const go = (id) => { setTabState(id); history.replaceState(null, "", `#${id}`); };
  const onTab = (id) => go(id);

  // who is signed in
  useEffect(() => {
    if (demo) { setSession({ user: { email: "demo@example.com" } }); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [demo]);

  const db = useMemo(() => (session ? (demo ? demoDb(demoSeed) : supabaseDb(supabase, session.user.email)) : null), [session?.user?.email, demo]);

  const loadGrounds = useCallback(async () => {
    try { setGrounds(await db.listGrounds()); } catch (e) { setError(e.message); }
  }, [db]);

  // approved? + their hunting grounds (row-level security only returns grounds they belong to)
  useEffect(() => {
    if (!db) return;
    (async () => {
      try {
        const u = await db.whoami();
        setMe(u);
        if (u) await loadGrounds();
      } catch (e) { setError(e.message); }
    })();
  }, [db]);

  const ground = (grounds || []).find((g) => g.id === gid) || (grounds || [])[0];
  const theme = useTheme(ground?.home || HOME);

  // that ground's stands, marks and everyone's hunts on it
  const loadData = useCallback(async () => {
    if (!ground) { setData(null); return; }
    try {
      const [stands, features, hunts] = await Promise.all([db.listStands(ground.id), db.listFeatures(ground.id), db.listHunts(ground.id)]);
      setData({ stands, features, hunts });
    } catch (e) { setError(e.message); }
  }, [db, ground?.id]);
  useEffect(() => { if (ground) localStorage.setItem(LAST_GROUND, ground.id); setData(null); setPin(null); loadData(); }, [ground?.id, loadData]);

  /** Run a save, report failure, then reload what it touched. */
  const save = useCallback(async (fn, { reload = "data", ok } = {}) => {
    try {
      await fn(db);
      if (reload === "data" || reload === "all") await loadData();
      if (reload === "grounds" || reload === "all") await loadGrounds();
      if (ok) setToast(ok);
      return true;
    } catch (e) { setToast(`Couldn't save — ${e.message}`); return false; }
  }, [db, loadData, loadGrounds]);

  const signIn = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  const signOut = () => { if (!demo) supabase.auth.signOut(); localStorage.removeItem(LAST_GROUND); if (demo) location.reload(); };

  if (error) return <Splash><p className="err">Couldn't load: {error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></Splash>;
  if (session === undefined) return <Splash><p className="muted">Loading…</p></Splash>;
  if (!session) return (
    <Splash>
      <p className="muted">Private app — sign in to continue.</p>
      <button className="btn primary" onClick={signIn}>Sign in with Google</button>
    </Splash>
  );
  if (me === null) return (
    <Splash>
      <p><b>{session.user.email}</b> isn't set up for Deercast.</p>
      <p className="muted">Ask John to add you.</p>
      <button className="btn" onClick={signOut}>Sign out</button>
    </Splash>
  );
  if (me === undefined || grounds === null) return <Splash><p className="muted">Loading your grounds…</p></Splash>;

  const common = { db, me, ground, grounds, data, demo, theme, save, toast: setToast, go, onMenu: () => setMenu(true),
    setGround: setGid, reloadGrounds: loadGrounds, reloadData: loadData, signOut };
  return (
    <>
      {ground ? <>
        <ForecastScreen {...common} active={tab === "forecast"} key={`f-${ground.id}-${pin ? `${pin.lat},${pin.lon}` : "home"}`} pin={pin} clearPin={() => setPin(null)} />
        <MapScreen {...common} active={tab === "map"} onForecastPin={(p) => { setPin(p); go("forecast"); }} />
        <HuntLogScreen {...common} active={tab === "log"} key={`l-${ground.id}`} />
        <ShotScreen {...common} active={tab === "shot"} />
      </> : tab !== "more" && <NoGround go={go} />}
      <MoreScreen {...common} active={tab === "more"} />
      <TabBar tab={tab} onTab={onTab} built={BUILT} />
      <Menu open={menu} onClose={() => setMenu(false)} ground={ground} grounds={grounds} onGround={setGid} theme={theme}
        email={session.user.email} onSignOut={signOut} onManage={() => { setMenu(false); go("more"); history.replaceState(null, "", "#more/grounds"); }} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function NoGround({ go }) {
  return (
    <div className="page"><div className="splash">
      <h1>No hunting ground yet</h1>
      <p className="muted">Create one (or ask a friend to add you to theirs) to see the forecast and map.</p>
      <button className="btn primary" onClick={() => { go("more"); history.replaceState(null, "", "#more/grounds"); }}>Set up a ground</button>
    </div></div>
  );
}

function Splash({ children }) {
  return (
    <div className="splash">
      <img src="/icon-192.png" alt="" width="96" height="96" />
      <h1>Deercast</h1>
      {children}
    </div>
  );
}
