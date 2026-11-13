// One data API for every screen. Two backends with the same methods:
//   supabaseDb — the real data; who may read/write what is enforced by row-level security (supabase/schema.sql)
//   demoDb     — made-up data kept in this browser only (for ?demo and testing)
// Records are the same JSON shapes the Streamlit app used (stands.json, hunts.json, gear.json, …).

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
export const nowIso = () => new Date().toISOString();
const lower = (e) => (e || "").trim().toLowerCase();

import { BUCKET } from "./photos.js";

// ---------------------------------------------------------------- Supabase
export function supabaseDb(sb, email) {
  const me = lower(email);
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const rows = (r) => ok(r).map((x) => x.data);
  return {
    kind: "supabase", email: me,
    async whoami() { const u = ok(await sb.from("app_users").select("*").eq("email", me)); return u[0] || null; },
    // app users (admins manage; everyone approved can see names)
    listUsers: async () => ok(await sb.from("app_users").select("*").order("email")),
    saveUser: async (u) => ok(await sb.from("app_users").upsert({ email: lower(u.email), name: u.name || "", role: u.role || "member" })),
    deleteUser: async (e) => ok(await sb.from("app_users").delete().eq("email", lower(e))),
    // grounds
    listGrounds: async () => ok(await sb.from("grounds").select("*").order("name")),
    saveGround: async (g) => ok(await sb.from("grounds").upsert({ id: g.id, name: g.name, owner: lower(g.owner), members: (g.members || []).map(lower), home: g.home, created: g.created || nowIso() })),
    deleteGround: async (id) => ok(await sb.from("grounds").delete().eq("id", id)),
    leaveGround: async (id) => ok(await sb.rpc("leave_ground", { gid: id })),
    // shared per ground
    listStands: async (gid) => rows(await sb.from("stands").select("data").eq("ground_id", gid)),
    saveStand: async (gid, s) => ok(await sb.from("stands").upsert({ id: `${gid}:${s.id}`, ground_id: gid, data: s })),
    deleteStand: async (gid, id) => ok(await sb.from("stands").delete().eq("id", `${gid}:${id}`)),
    listFeatures: async (gid) => rows(await sb.from("features").select("data").eq("ground_id", gid)),
    saveFeature: async (gid, f) => ok(await sb.from("features").upsert({ id: `${gid}:${f.id}`, ground_id: gid, data: f })),
    deleteFeature: async (gid, id) => ok(await sb.from("features").delete().eq("id", `${gid}:${id}`)),
    // hunts: everyone's on the ground are visible; you write only your own
    listHunts: async (gid) => ok(await sb.from("hunts").select("owner,data").eq("ground_id", gid)).map((r) => ({ ...r.data, owner: r.owner })),
    saveHunt: async (h) => { const { owner, ...d } = h; return ok(await sb.from("hunts").upsert({ id: `${me}:${d.id}`, ground_id: d.ground_id, owner: me, data: d })); },
    deleteHunt: async (id) => ok(await sb.from("hunts").delete().eq("id", `${me}:${id}`)),
    // shots (personal)
    listShots: async () => rows(await sb.from("shots").select("data").eq("owner", me)),
    // everyone's shots on a ground (row-level security: admins see them all, others only their own)
    listGroundShots: async (gid) => ok(await sb.from("shots").select("owner,data").eq("ground_id", gid)).map((r) => ({ ...r.data, owner: r.owner })),
    saveShot: async (s) => ok(await sb.from("shots").upsert({ id: `${me}:${s.id}`, ground_id: s.ground_id || null, owner: me, data: s })),
    deleteShot: async (id) => ok(await sb.from("shots").delete().eq("id", `${me}:${id}`)),
    // personal documents: gear, active_hunt
    getDoc: async (name, dflt) => { const r = ok(await sb.from("user_docs").select("data").eq("owner", me).eq("name", name)); return r.length ? r[0].data : dflt; },
    putDoc: async (name, data) => (data == null
      ? ok(await sb.from("user_docs").delete().eq("owner", me).eq("name", name))
      : ok(await sb.from("user_docs").upsert({ owner: me, name, data }))),
    // everyone else's sits in progress, any ground (More → Who's hunting; read-only by row-level security)
    listLiveSits: async () => ok(await sb.from("user_docs").select("owner,data").eq("name", "active_hunt").neq("owner", me))
      .map((r) => ({ ...r.data, owner: r.owner })),
    // chat: one room for all approved users (newest 200, oldest first)
    listChat: async () => ok(await sb.from("chat").select("*").order("created", { ascending: false }).limit(200)).reverse(),
    lastChat: async () => ok(await sb.from("chat").select("created,author").neq("author", me).order("created", { ascending: false }).limit(1))[0] || null,
    postChat: async (body) => ok(await sb.from("chat").insert({ id: newId() + newId(), author: me, body })),
    deleteChat: async (id) => ok(await sb.from("chat").delete().eq("id", id)),
    // punch list (admins)
    listPunch: async () => rows(await sb.from("punchlist").select("data")),
    savePunch: async (p) => ok(await sb.from("punchlist").upsert({ id: p.id, data: p })),
    deletePunch: async (id) => ok(await sb.from("punchlist").delete().eq("id", id)),
    // hunt photos (Storage bucket; rules in schema.sql)
    uploadPhoto: async (path, blob) => ok(await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "86400" })),
    photoUrls: async (paths) => Object.fromEntries(ok(await sb.storage.from(BUCKET).createSignedUrls(paths, 6 * 3600))
      .filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl])),
    deletePhotos: async (paths) => (paths.length ? ok(await sb.storage.from(BUCKET).remove(paths)) : null),
  };
}

// ---------------------------------------------------------------- demo (browser-only)
const DEMO_KEY = "deercast.demo.v2";
export function demoDb(seed) {
  let st;
  try { st = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { st = null; }
  if (!st) st = seed();
  const save = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(st)); } catch { /* ignore */ } };
  const me = "demo@example.com";
  const up = (arr, rec, key = "id") => { const i = arr.findIndex((x) => x[key] === rec[key]); if (i >= 0) arr[i] = rec; else arr.push(rec); save(); };
  const del = (arr, pred) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1); save(); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    kind: "demo", email: me,
    whoami: async () => st.users.find((u) => u.email === me),
    listUsers: async () => clone(st.users),
    saveUser: async (u) => up(st.users, { ...u, email: lower(u.email) }, "email"),
    deleteUser: async (e) => del(st.users, (u) => u.email === lower(e)),
    listGrounds: async () => clone(st.grounds.filter((g) => g.owner === me || g.members.includes(me) || st.users.find((u) => u.email === me)?.role === "admin")),
    saveGround: async (g) => up(st.grounds, clone(g)),
    deleteGround: async (id) => del(st.grounds, (g) => g.id === id),
    leaveGround: async (id) => { const g = st.grounds.find((x) => x.id === id); if (g) g.members = g.members.filter((m) => m !== me); save(); },
    listStands: async (gid) => clone(st.stands[gid] || []),
    saveStand: async (gid, s) => up((st.stands[gid] ||= []), clone(s)),
    deleteStand: async (gid, id) => del(st.stands[gid] || [], (s) => s.id === id),
    listFeatures: async (gid) => clone(st.features[gid] || []),
    saveFeature: async (gid, f) => up((st.features[gid] ||= []), clone(f)),
    deleteFeature: async (gid, id) => del(st.features[gid] || [], (f) => f.id === id),
    listHunts: async (gid) => clone(st.hunts.filter((h) => h.ground_id === gid)),
    saveHunt: async (h) => up(st.hunts, { ...clone(h), owner: me }),
    deleteHunt: async (id) => del(st.hunts, (h) => h.id === id && h.owner === me),
    listShots: async () => clone(st.shots),
    listLiveSits: async () => clone(st.liveOthers || []),
    listChat: async () => clone(st.chat ||= [{ id: "m1", created: new Date(Date.now() - 50 * 60e3).toISOString(), author: "partner@example.com", body: "Two does at the creek already" }]),
    lastChat: async () => clone((st.chat || []).filter((m) => m.author !== me).slice(-1)[0] || null),
    postChat: async (body) => { (st.chat ||= []).push({ id: newId(), created: nowIso(), author: me, body }); save(); },
    deleteChat: async (id) => del(st.chat || [], (m) => m.id === id),
    listGroundShots: async (gid) => clone(st.shots.filter((s) => s.ground_id === gid).map((s) => ({ owner: me, ...s }))),
    saveShot: async (s) => up(st.shots, clone(s)),
    deleteShot: async (id) => del(st.shots, (s) => s.id === id),
    getDoc: async (name, dflt) => (name in st.docs ? clone(st.docs[name]) : dflt),
    putDoc: async (name, data) => { if (data == null) delete st.docs[name]; else st.docs[name] = clone(data); save(); },
    listPunch: async () => clone(st.punch),
    savePunch: async (p) => up(st.punch, clone(p)),
    deletePunch: async (id) => del(st.punch, (p) => p.id === id),
    // demo photos stay in this browser (data URLs; very small budget)
    uploadPhoto: async (path, blob) => { demoPhotos[path] = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }); keepDemoPhotos(); },
    photoUrls: async (paths) => Object.fromEntries(paths.filter((p) => demoPhotos[p]).map((p) => [p, demoPhotos[p]])),
    deletePhotos: async (paths) => { for (const p of paths) delete demoPhotos[p]; keepDemoPhotos(); },
  };
}
const DEMO_PHOTOS = "deercast.demo.photos";
const demoPhotos = (() => { try { return JSON.parse(localStorage.getItem(DEMO_PHOTOS)) || {}; } catch { return {}; } })();
const keepDemoPhotos = () => { try { localStorage.setItem(DEMO_PHOTOS, JSON.stringify(demoPhotos)); } catch { /* over the browser's limit: kept until reload */ } };
