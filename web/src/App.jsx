import { useEffect, useState } from "react";
import { supabase, configured } from "./supabase.js";
import MapScreen from "./MapScreen.jsx";
import { demoData } from "./demo.js";

const LAST_GROUND = "deercast.ground";

export default function App() {
  const demo = !configured;
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [approved, setApproved] = useState(undefined);
  const [grounds, setGrounds] = useState([]);
  const [gid, setGid] = useState(() => localStorage.getItem(LAST_GROUND));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

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
  return <MapScreen ground={ground} grounds={grounds} onGround={setGid} data={data} email={session.user.email}
    onSignOut={signOut} demo={demo} />;
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
