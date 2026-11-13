import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configured } from "./supabase.js";
import MapScreen from "./MapScreen.jsx";
import ForecastScreen from "./ForecastScreen.jsx";
import HuntLogScreen from "./HuntLogScreen.jsx";
import MoreScreen from "./MoreScreen.jsx";
import ShotScreen from "./ShotScreen.jsx";
import { Menu, TabBar } from "./Shell.jsx";
import { demoSeed } from "./demo.js";
import { demoDb, nowIso, supabaseDb } from "./lib/db.js";
import TrackMode from "./TrackMode.jsx";
import HuntMap from "./HuntMap.jsx";
import { shotSighting } from "./lib/huntmap.js";
import { resolveTheme } from "./lib/theme.js";
import { useUpdate } from "./lib/update.js";
import { CHAT_READ } from "./Chat.jsx";

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

const TAB_IDS = ["forecast", "map", "log", "more"];
const BUILT = ["forecast", "map", "log", "more"];

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
  // Screens under an open overlay are hidden (display:none), not just covered: on iPhone Safari two stacked
  // fixed scrolling layers can send taps to the hidden one underneath — the app looked frozen (scroll worked,
  // buttons didn't) and a tap in the Shot analyzer opened More → Gun setup underneath it.
  // over the hunt session: the tracking map for a shot, or the hit analysis for a shot (shotId null = calculator)
  const [overlay, setOverlay] = useState(null); // { kind: "track", shot, center, live } | { kind: "analysis", shotId }
  const [shotsV, setShotsV] = useState(0);      // bumped when an overlay closes → Hunt Log re-reads shots
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);
  const go = (id) => { setTabState(id); history.replaceState(null, "", `#${id}`); };
  // More's sub-page (grounds, gear, gun, regs, dev, history) — kept here because Hunt history is drawn by the Hunt screen
  const morePageFromHash = () => { const [t, p] = location.hash.slice(1).split("/"); return t === "more" && p ? p : null; };
  const [morePage, setMorePageState] = useState(morePageFromHash);
  useEffect(() => { const f = () => setMorePageState(morePageFromHash()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const setMorePage = (p) => { setMorePageState(p); history.replaceState(null, "", p ? `#more/${p}` : "#more"); document.querySelectorAll(".page").forEach((el) => el.scrollTo?.(0, 0)); };
  // a tab tapped while the Shot analyzer or a hunt map is open closes it and goes there
  const onTab = (id) => { if (overlay) closeOverlay(); go(id); if (id === "more") setMorePage(null); };

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
  const update = useUpdate(); // a newer build is published → dot on More + "Update" row
  // unread chat: newest message from someone else vs. when you last looked (checked every minute)
  const [chatNew, setChatNew] = useState(false);
  const checkChat = useCallback(async () => {
    if (!db?.lastChat || !me) return;
    try { const m = await db.lastChat(); setChatNew(!!m && m.created > (localStorage.getItem(CHAT_READ) || "")); } catch { /* ignore */ }
  }, [db, me]);
  useEffect(() => { checkChat(); const i = setInterval(checkChat, 60e3); return () => clearInterval(i); }, [checkChat]);

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

  /** Merge fields into a saved shot (hit analysis saves this way so it never overwrites tracking). */
  const patchShot = useCallback((id, patch, ok) => save(async (d) => {
    const cur = (await d.listShots()).find((x) => x.id === id);
    if (!cur) throw new Error("that shot wasn't found");
    await d.saveShot({ ...cur, ...patch, updated: nowIso() });
  }, { reload: "none", ok }), [save]);
  const closeOverlay = () => { setOverlay(null); setShotsV((v) => v + 1); };

  // Photos of a recovered deer, taken on the tracking map, go on the shot's hunt: the sit in progress
  // (the active_hunt doc) or a logged hunt.
  const [trackHunt, setTrackHunt] = useState(null); // { hunt, live }
  const trackHuntId = overlay?.kind === "track" ? overlay.shot?.hunt_id : null;
  useEffect(() => {
    setTrackHunt(null);
    if (!trackHuntId || !db) return;
    const logged = (data?.hunts || []).find((h) => h.id === trackHuntId);
    if (logged) { setTrackHunt({ hunt: logged, live: false }); return; }
    db.getDoc("active_hunt", null).then((v) => { if (v?.id === trackHuntId) setTrackHunt({ hunt: v, live: true }); }).catch(() => {});
  }, [trackHuntId, db]);
  const trackPhotos = trackHunt && {
    photos: trackHunt.hunt.photos || [], sightings: trackHunt.hunt.sightings || [], groundId: trackHunt.hunt.ground_id || ground?.id,
    onChange: async (photos) => {
      if (trackHunt.live) {
        const cur = await db.getDoc("active_hunt", null);
        if (cur?.id !== trackHunt.hunt.id) throw new Error("that sit has ended — add the photo on the logged hunt");
        const v = { ...cur, photos }; await db.putDoc("active_hunt", v); setTrackHunt({ hunt: v, live: true });
      } else {
        const h = { ...trackHunt.hunt, photos };
        if (!(await save((d) => d.saveHunt(h), { reload: "data" }))) throw new Error("not saved");
        setTrackHunt({ hunt: h, live: false });
      }
    },
  };

  const signIn = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + import.meta.env.BASE_URL } });
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

  const showHistory = tab === "more" && morePage === "history" && !!ground;
  const openTrack = (shot, center, live, stand, sighting = null) => setOverlay({ kind: "track", shot, center, live, stand, sighting });
  const openAnalysis = (shotId) => setOverlay({ kind: "analysis", shotId });
  const openHuntMap = (hunt, shots, tz) => setOverlay({ kind: "huntmap", hunt, shots, tz });
  const common = { db, me, ground, grounds, data, demo, theme, save, toast: setToast, go, onMenu: () => setMenu(true), openAnalysis, openTrack, openHuntMap, shotsV, patchShot,
    setGround: setGid, reloadGrounds: loadGrounds, reloadData: loadData, signOut };
  return (
    <>
      {ground ? <>
        <ForecastScreen {...common} active={tab === "forecast" && !overlay} key={`f-${ground.id}-${pin ? `${pin.lat},${pin.lon}` : "home"}`} pin={pin} clearPin={() => setPin(null)} />
        <MapScreen {...common} active={tab === "map" && !overlay} onForecastPin={(p) => { setPin(p); go("forecast"); }} />
        <HuntLogScreen {...common} active={(tab === "log" || showHistory) && !overlay} view={showHistory ? "history" : "live"} key={`l-${ground.id}`}
          onBack={() => setMorePage(null)} openHistory={() => { go("more"); setMorePage("history"); }} />
      </> : tab !== "more" && <NoGround go={() => { go("more"); setMorePage("grounds"); }} />}
      <MoreScreen {...common} active={tab === "more" && !showHistory && !overlay} page={morePage === "history" ? null : morePage} open={setMorePage}
        update={update} chatNew={chatNew} onChatRead={() => setChatNew(false)} />
      {overlay?.kind !== "track" && <TabBar tab={tab} onTab={onTab} built={BUILT} dots={{ more: !!update || chatNew }} />}
      {overlay?.kind === "analysis" && <div className="overlay with-tabs"><ShotScreen {...common} active shotId={overlay.shotId} onClose={closeOverlay} /></div>}
      {overlay?.kind === "track" && <div className="overlay"><TrackMode shot={overlay.shot} center={overlay.center} stand={overlay.stand || overlay.center} live={overlay.live}
        sighting={overlay.sighting || shotSighting((data?.hunts || []).find((h) => h.id === overlay.shot.hunt_id), overlay.shot)}
        onAnalysis={() => { setOverlay({ kind: "analysis", shotId: overlay.shot.id }); }} onClose={closeOverlay} photos={trackPhotos} db={db} toast={setToast}
        onSave={async (rec) => { try { await db.saveShot(rec); } catch (e) { setToast(`Couldn't save — ${e.message}`); throw e; } }} /></div>}
      {overlay?.kind === "huntmap" && <div className="overlay with-tabs"><HuntMap db={db} hunt={overlay.hunt} shots={overlay.shots} tz={overlay.tz}
        stands={data?.stands || []} features={data?.features || []} onClose={closeOverlay} /></div>}
      <Menu open={menu} update={update} onClose={() => setMenu(false)} ground={ground} grounds={grounds} onGround={setGid} theme={theme}
        email={session.user.email} onSignOut={signOut} onManage={() => { setMenu(false); go("more"); setMorePage("grounds"); }} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function NoGround({ go }) {
  return (
    <div className="page"><div className="splash">
      <h1>No hunting ground yet</h1>
      <p className="muted">Create one (or ask a friend to add you to theirs) to see the forecast and map.</p>
      <button className="btn primary" onClick={go}>Set up a ground</button>
    </div></div>
  );
}

function Splash({ children }) {
  return (
    <div className="splash">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width="96" height="96" />
      <h1>Deercast</h1>
      {children}
    </div>
  );
}
