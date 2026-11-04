import { useEffect, useState } from "react";
import { supabase, configured } from "./supabase.js";
import MapScreen from "./MapScreen.jsx";
import ForecastScreen from "./ForecastScreen.jsx";
import { Menu, TabBar } from "./Shell.jsx";
import { demoData } from "./demo.js";
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
    // quick toggle: flip until the next automatic switch
    flip: () => setPref({ mode: info.theme === "dark" ? "light" : "dark", until: info.next.getTime() }),
    choose: (mode) => setPref(mode === "auto" ? { mode: "auto" } : { mode, until: null }),
  };
}

export default function App() {
  const demo = !configured || new URLSearchParams(location.search).has("demo"); // ?demo = made-up data only
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [approved, setApproved] = useState(undefined);
  const [grounds, setGrounds] = useState([]);
  const [gid, setGid] = useState(() => localStorage.getItem(LAST_GROUND));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTabState] = useState(() => (location.hash.slice(1) === "map" ? "map" : "forecast"));
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2400); return () => clearTimeout(t); }, [toast]);
  const BUILT = ["forecast", "map"];
  const setTab = (id, built) => {
    if (!built) return setToast("Coming next — use the current app for now");
    setTabState(id); history.replaceState(null, "", `#${id}`);
  };

  // who is signed in
  useEffect(() => {
    if (demo) { setSession({ user: { email: "demo" } }); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [demo]);

  // approved? + their hunting grounds (row-level security only returns grounds they belong to)
  useEffect(() => {
    if (!session) return;
    if (demo) { setApproved(true); setGrounds(demoData.grounds); return; }
    (async () => {
      const u = await supabase.from("app_users").select("email,name,role");
      if (u.error) return setError(u.error.message);
      if (!u.data.length) return setApproved(false);
      setApproved(true);
      const g = await supabase.from("grounds").select("*").order("name");
      if (g.error) return setError(g.error.message);
      setGrounds(g.data);
    })();
  }, [session, demo]);

  const ground = grounds.find((g) => g.id === gid) || grounds[0];
  const theme = useTheme(ground?.home || HOME);

  // that ground's stands, marks and everyone's hunts on it
  useEffect(() => {
    if (!ground) return;
    localStorage.setItem(LAST_GROUND, ground.id);
    setData(null);
    if (demo) { setData(demoData.forGround(ground.id)); return; }
    (async () => {
      const [s, f, h] = await Promise.all([
        supabase.from("stands").select("data").eq("ground_id", ground.id),
        supabase.from("features").select("data").eq("ground_id", ground.id),
        supabase.from("hunts").select("owner,data").eq("ground_id", ground.id),
      ]);
      const bad = [s, f, h].find((r) => r.error);
      if (bad) return setError(bad.error.message);
      setData({ stands: s.data.map((r) => r.data), features: f.data.map((r) => r.data),
        hunts: h.data.map((r) => ({ ...r.data, owner: r.owner })) });
    })();
  }, [ground?.id, demo]);

  const signIn = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  const signOut = () => { if (!demo) supabase.auth.signOut(); localStorage.removeItem(LAST_GROUND); };

  if (error) return <Splash><p className="err">Couldn't load: {error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></Splash>;
  if (session === undefined) return <Splash><p className="muted">Loading…</p></Splash>;
  if (!session) return (
    <Splash>
      <p className="muted">Private app — sign in to continue.</p>
      <button className="btn primary" onClick={signIn}>Sign in with Google</button>
    </Splash>
  );
  if (approved === false) return (
    <Splash>
      <p><b>{session.user.email}</b> isn't set up for Deercast.</p>
      <p className="muted">Ask John to add you.</p>
      <button className="btn" onClick={signOut}>Sign out</button>
    </Splash>
  );
  if (approved === undefined || (approved && !grounds.length && !error)) return <Splash><p className="muted">Loading your grounds…</p></Splash>;
  const common = { ground, data, demo, theme, onMenu: () => setMenu(true) };
  return (
    <>
      <ForecastScreen {...common} active={tab === "forecast"} key={`f-${ground?.id}`} />
      <MapScreen {...common} active={tab === "map"} />
      <TabBar tab={tab} onTab={setTab} built={BUILT} />
      <Menu open={menu} onClose={() => setMenu(false)} ground={ground} grounds={grounds} onGround={setGid} theme={theme}
        email={session.user.email} onSignOut={signOut} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
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
