import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import NumInput from "./NumInput.jsx";
import { GroundChip, ThemeButton } from "./Shell.jsx";
import { newId, nowIso } from "./lib/db.js";
import { BOW_TYPES, TIP_FACTOR, flightTime, foc, focClass, summary } from "./lib/archery.js";
import { countyFor, geocodeZip, myLocation, normalizeCounty, REG_DATA } from "./lib/places.js";
import { dailyAstro } from "./lib/model/astro.js";
import { dateKey, daysBetween } from "./lib/model/tz.js";
import { MODEL_VERSION } from "./HuntLogScreen.jsx";

const PAGES = { grounds: "Hunting grounds", gear: "Bow setup", regs: "Regulations", dev: "Development" };
const pageFromHash = () => { const [t, p] = location.hash.slice(1).split("/"); return t === "more" && PAGES[p] ? p : null; };

export default function MoreScreen(props) {
  const { active, me, ground, demo, theme, onMenu, signOut } = props;
  const [page, setPageState] = useState(pageFromHash);
  useEffect(() => { if (active) setPageState(pageFromHash()); }, [active]);
  useEffect(() => { const f = () => setPageState(pageFromHash()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const open = (p) => { setPageState(p); history.replaceState(null, "", p ? `#more/${p}` : "#more"); document.querySelector(".page.more")?.scrollTo(0, 0); };
  const admin = me?.role === "admin";

  return (
    <div className="page more" style={{ display: active ? undefined : "none" }}>
      <header className="page-top">
        {page ? <button className="chip" onClick={() => open(null)}><Icon name="chev" size={16} style={{ transform: "rotate(90deg)" }} /><span>More</span></button>
          : <GroundChip ground={ground} onClick={onMenu} demo={demo} />}
        <span className="spacer" />
        <ThemeButton theme={theme} />
      </header>
      <div className="page-title"><h1>{page ? PAGES[page] : "More"}</h1></div>
      {!page && (
        <>
          <section className="card list">
            <button className="nav-row" onClick={() => open("grounds")}><Icon name="ground" /><span>Hunting grounds</span><span className="muted small">{ground?.name}</span><Icon name="chev" className="icon chev-r" /></button>
            <button className="nav-row" onClick={() => open("gear")}><Icon name="bow" /><span>Bow setup</span><Icon name="chev" className="icon chev-r" /></button>
            <button className="nav-row" onClick={() => props.openAnalysis?.(null)}><Icon name="target" /><span>Shot analyzer</span><span className="muted small">calculator</span><Icon name="chev" className="icon chev-r" /></button>
            <button className="nav-row" onClick={() => open("regs")}><Icon name="book" /><span>Regulations</span><Icon name="chev" className="icon chev-r" /></button>
            {admin && <button className="nav-row" onClick={() => open("dev")}><Icon name="tools" /><span>Development</span><Icon name="chev" className="icon chev-r" /></button>}
          </section>
          <section className="card">
            <div className="muted small">Signed in as <b>{me?.name || me?.email}</b> ({me?.email}){admin ? " · admin" : ""}</div>
            <button className="link" onClick={signOut}>Sign out</button>
            <div className="muted small">Deercast {MODEL_VERSION} · updated {typeof __BUILD__ === "undefined" ? "dev" : __BUILD__}{demo ? " · demo data" : ""}</div>
          </section>
        </>
      )}
      {page === "grounds" && <GroundsPage {...props} />}
      {page === "gear" && <GearPage {...props} />}
      {page === "regs" && <RegsPage {...props} />}
      {page === "dev" && (admin ? <DevPage {...props} /> : <p className="muted">Admins only.</p>)}
    </div>
  );
}

// ================================================================ grounds
function GroundsPage({ db, me, ground, grounds, save, setGround, toast }) {
  const [users, setUsers] = useState([]);
  const loadUsers = () => db.listUsers().then(setUsers).catch(() => setUsers([]));
  useEffect(() => { loadUsers(); }, [db]);
  const nameOf = (e) => users.find((u) => u.email === e)?.name || e;
  const owner = ground && ground.owner === db.email;
  const [rename, setRename] = useState(ground?.name || "");
  useEffect(() => setRename(ground?.name || ""), [ground?.id]);
  const [zip, setZip] = useState("");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nu, setNu] = useState({ email: "", name: "", addHere: true });
  const [ng, setNg] = useState({ name: "", zip: "" });
  const saveG = (g, ok) => save((d) => d.saveGround(g), { reload: "grounds", ok });

  const homeFrom = async (how) => {
    setBusy(how);
    try {
      let home;
      if (how === "zip") home = await geocodeZip(zip);
      else {
        const p = await myLocation();
        const c = await countyFor(p.lat, p.lon).catch(() => ({}));
        home = { lat: p.lat, lon: p.lon, label: ground.name, state: c.state || ground.home?.state || null, zip: null };
      }
      await saveG({ ...ground, home }, `Home set to ${home.label}`);
      setZip("");
    } catch (e) { toast(e.message); }
    setBusy("");
  };
  const create = async () => {
    if (!ng.name.trim()) return toast("Give the ground a name");
    setBusy("create");
    try {
      let home;
      if (ng.zip) home = await geocodeZip(ng.zip);
      else {
        try { const p = await myLocation(); const c = await countyFor(p.lat, p.lon).catch(() => ({})); home = { lat: p.lat, lon: p.lon, label: ng.name.trim(), state: c.state, zip: null }; }
        catch { home = { ...(ground?.home || { lat: 37.3006, lon: -86.0608, state: "KY" }), label: ng.name.trim() }; }
      }
      const g = { id: newId(), name: ng.name.trim(), owner: db.email, members: [db.email], home, created: nowIso() };
      if (await saveG(g, `Created ${g.name}`)) { setGround(g.id); setNg({ name: "", zip: "" }); }
    } catch (e) { toast(e.message); }
    setBusy("");
  };

  return (
    <>
      <p className="muted small">A ground is a property. Its stands, bait, water/cover marks and deer sightings are shared with its members. Hunt logs, bow setups and shots stay personal.</p>
      <section className="card">
        <span className="h2">Your grounds</span>
        {!grounds.length && <p className="muted small">You don't have a hunting ground yet — create one below.</p>}
        {grounds.map((g) => (
          <div key={g.id} className="rank-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{g.name}{g.id === ground?.id && <span className="tag">current</span>}</div>
              <div className="muted small">{g.owner === db.email ? "You own it" : `Shared by ${nameOf(g.owner)}`} · {g.members.length} member{g.members.length === 1 ? "" : "s"} · {g.home?.label || "—"}</div>
            </div>
            {g.id !== ground?.id && <button className="btn sm" onClick={() => setGround(g.id)}>Switch</button>}
          </div>
        ))}
      </section>

      {ground && (
        <section className="card">
          <span className="h2">{ground.name}</span>
          {!owner && (
            <>
              <p className="muted small">Owned by {nameOf(ground.owner)}. Only the owner can change its settings or members.</p>
              <div className="small"><b>Members:</b> {ground.members.map(nameOf).join(", ")}</div>
              <button className="btn" onClick={() => setConfirm("leave")}>Leave this ground</button>
              {confirm === "leave" && <div className="confirm">Leave {ground.name}? You'll lose access to its shared map. Your own hunt logs are kept.
                <div className="btn-row"><button className="btn danger" onClick={() => save((d) => d.leaveGround(ground.id), { reload: "grounds", ok: "Left the ground" })}>Leave</button><button className="btn" onClick={() => setConfirm("")}>Stay</button></div></div>}
            </>
          )}
          {owner && (
            <>
              <label className="field"><span>Name</span>
                <div className="inline"><input value={rename} onChange={(e) => setRename(e.target.value)} />
                  <button className="btn sm" disabled={!rename.trim() || rename.trim() === ground.name} onClick={() => saveG({ ...ground, name: rename.trim() }, "Renamed")}>Rename</button></div></label>
              <div className="sub-h">Home location</div>
              <p className="muted small">Where the forecast, map and regulations open for this ground. Now: {ground.home?.label || "—"} ({ground.home?.lat?.toFixed(4)}, {ground.home?.lon?.toFixed(4)})</p>
              <div className="inline">
                <input inputMode="numeric" maxLength="5" placeholder="ZIP code" value={zip} onChange={(e) => setZip(e.target.value)} />
                <button className="btn sm" disabled={!zip || !!busy} onClick={() => homeFrom("zip")}>{busy === "zip" ? "…" : "Use ZIP"}</button>
              </div>
              <button className="btn wide" disabled={!!busy} onClick={() => homeFrom("gps")}>{busy === "gps" ? "Finding you…" : "Use where I am now"}</button>

              <div className="sub-h">Members</div>
              {ground.members.map((m) => (
                <div key={m} className="rank-row">
                  <div style={{ flex: 1, minWidth: 0 }}><div className="name">{nameOf(m)}{m === ground.owner && <span className="tag">owner</span>}</div><div className="muted small">{m}</div></div>
                  {m !== ground.owner && <button className="btn sm" onClick={() => saveG({ ...ground, members: ground.members.filter((x) => x !== m) }, `Removed ${nameOf(m)}`)}>Remove</button>}
                </div>
              ))}
              {users.filter((u) => !ground.members.includes(u.email)).length > 0 ? (
                <AddMember users={users.filter((u) => !ground.members.includes(u.email))} onAdd={(e) => saveG({ ...ground, members: [...ground.members, e] }, `Added ${nameOf(e)}`)} />
              ) : <p className="muted small">Everyone who can sign in is already a member. {me?.role === "admin" ? "Add new people under App users below." : "Ask the app admin to add someone first."}</p>}

              <details className="more-box"><summary>Delete this ground</summary>
                <p className="muted small">Removes the ground and its stands and marks for all members. Members' personal hunt logs are kept.</p>
                <button className="btn danger" onClick={() => setConfirm("delete")}>Delete “{ground.name}”</button>
                {confirm === "delete" && <div className="confirm">Really delete {ground.name} for everyone?
                  <div className="btn-row"><button className="btn danger" onClick={async () => { if (await save((d) => d.deleteGround(ground.id), { reload: "grounds", ok: "Ground deleted" })) setGround(null); }}>Delete</button><button className="btn" onClick={() => setConfirm("")}>Cancel</button></div></div>}
              </details>
            </>
          )}
        </section>
      )}

      <section className="card">
        <span className="h2">Create a hunting ground</span>
        <label className="field"><span>Name</span><input placeholder="e.g. Ohio lease, Dad's farm" value={ng.name} onChange={(e) => setNg({ ...ng, name: e.target.value })} /></label>
        <label className="field"><span>Home ZIP (optional — otherwise where you are now)</span><input inputMode="numeric" maxLength="5" value={ng.zip} onChange={(e) => setNg({ ...ng, zip: e.target.value })} /></label>
        <button className="btn primary wide" disabled={busy === "create"} onClick={create}>{busy === "create" ? "Creating…" : "Create"}</button>
      </section>

      {me?.role === "admin" && (
        <section className="card">
          <span className="h2">App users</span>
          <p className="muted small">Only these Google accounts can sign in. Add someone here, then add them to a ground.</p>
          {users.map((u) => (
            <div key={u.email} className="rank-row">
              <div style={{ flex: 1, minWidth: 0 }}><div className="name">{u.name || u.email}{u.role === "admin" && <span className="tag">admin</span>}</div><div className="muted small">{u.email}</div></div>
              {u.email !== db.email && <button className="btn sm" onClick={async () => { if (await save((d) => d.deleteUser(u.email), { reload: "none", ok: `Removed ${u.name || u.email}` })) loadUsers(); }}>Remove</button>}
            </div>
          ))}
          <label className="field"><span>Google email</span><input type="email" autoCapitalize="none" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></label>
          <label className="field"><span>Name</span><input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></label>
          {owner && <label className="check"><input type="checkbox" checked={nu.addHere} onChange={(e) => setNu({ ...nu, addHere: e.target.checked })} /> Also add to “{ground.name}”</label>}
          <button className="btn primary wide" onClick={async () => {
            const e = nu.email.trim().toLowerCase();
            if (!e.includes("@")) return toast("Enter a valid email address");
            const ok = await save((d) => d.saveUser({ email: e, name: nu.name.trim() || e.split("@")[0], role: "member" }), { reload: "none" });
            if (!ok) return;
            if (owner && nu.addHere && !ground.members.includes(e)) await saveG({ ...ground, members: [...ground.members, e] });
            toast(`Added ${nu.name.trim() || e}. They can now sign in with Google.`);
            setNu({ email: "", name: "", addHere: true }); loadUsers();
          }}>Add user</button>
        </section>
      )}
    </>
  );
}

function AddMember({ users, onAdd }) {
  const [who, setWho] = useState(users[0]?.email || "");
  return (
    <label className="field"><span>Add a member</span>
      <div className="inline">
        <select value={who} onChange={(e) => setWho(e.target.value)}>{users.map((u) => <option key={u.email} value={u.email}>{u.name || u.email} ({u.email})</option>)}</select>
        <button className="btn sm" onClick={() => who && onAdd(who)}>Add</button>
      </div>
    </label>
  );
}

// ================================================================ bow setup
const NEW = "__new";
function GearPage({ db, toast }) {
  const [gear, setGear] = useState(null);
  useEffect(() => { db.getDoc("gear", { setups: [], active: null }).then(setGear).catch(() => setGear({ setups: [], active: null })); }, [db]);
  const [pick, setPick] = useState(null);
  useEffect(() => { if (gear && pick === null) setPick(gear.active || gear.setups[0]?.id || NEW); }, [gear]);
  const cur = gear?.setups.find((s) => s.id === pick);
  const blank = { name: gear?.setups.length ? "" : "My bow", bow_type: "Compound", bow_model: "", rated_fps: 340, rated_bolt_gr: 400, draw_weight: 65,
    draw_length: 29, arrow_model: "", arrow_gr: 425, tip_type: "Fixed-blade broadhead", tip_model: "", string_gr: 15, chrono_fps: null };
  const [f, setF] = useState(blank);
  useEffect(() => { if (gear) setF(cur ? { ...blank, ...cur } : blank); }, [pick, gear]);
  const put = async (g, msg) => { try { await db.putDoc("gear", g); setGear(g); if (msg) toast(msg); return true; } catch (e) { toast(`Couldn't save — ${e.message}`); return false; } };
  const num = (k) => (v) => setF({ ...f, [k]: v ?? "" });
  const txt = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!gear) return <p className="muted">Loading…</p>;
  const s = cur ? summary(cur) : null;

  const saveSetup = async () => {
    if (!f.name.trim()) return toast("Name the setup");
    const rec = { ...f, id: cur?.id || newId(), name: f.name.trim(), chrono_fps: +f.chrono_fps || null };
    for (const k of ["rated_fps", "rated_bolt_gr", "draw_weight", "draw_length", "arrow_gr", "string_gr"]) rec[k] = +rec[k] || 0;
    for (const k of ["arrow_len", "balance_in", "tip_gr"]) rec[k] = +rec[k] || null;
    rec.foc = foc(rec.arrow_len, rec.balance_in);
    const setups = [...gear.setups.filter((x) => x.id !== rec.id && x.name !== rec.name), rec];
    if (await put({ setups, active: rec.id }, `Saved ${rec.name}`)) setPick(rec.id);
  };

  return (
    <>
      <p className="muted small">Enter your setup once. The Shot & Recovery page uses it to judge penetration — e.g. whether an arrow that hit the shoulder likely broke through to the vitals.</p>
      <label className="field"><span>Setup</span>
        <select value={pick || NEW} onChange={(e) => setPick(e.target.value)}>
          {gear.setups.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === gear.active ? " (active)" : ""}</option>)}
          <option value={NEW}>+ New setup</option>
        </select></label>

      {cur && s && (
        <section className="card">
          <div className="stats">
            <div><span className="big">{Math.round(s.fps)}</span><span className="label">fps {s.measured ? "measured" : "estimated"}</span></div>
            <div><span className="big">{Math.round(s.ke)}</span><span className="label">ft·lb · {s.keClass}</span></div>
            <div><span className="big">{s.momentum.toFixed(2)}</span><span className="label">momentum · bone {s.bone}</span></div>
          </div>
          {foc(cur.arrow_len, cur.balance_in) != null && <p className="small"><b>FOC {foc(cur.arrow_len, cur.balance_in).toFixed(1)}%</b> — {focClass(foc(cur.arrow_len, cur.balance_in))}. 10–15% is the usual hunting range; higher FOC helps penetration and broadhead flight but drops more at long range.</p>}
          {cur.tip_gr > 0 && <p className="muted small">{cur.tip_gr} gr {/broadhead/i.test(cur.tip_type) ? "broadhead" : "point"}{cur.arrow_gr > 0 ? ` — ${Math.round((cur.tip_gr / cur.arrow_gr) * 100)}% of the arrow's weight` : ""}.</p>}
          {s.gpp && <p className="muted small">{s.gpp.toFixed(1)} grains per pound of draw weight{s.gpp < 6 ? " — light; heavier arrows penetrate better." : "."}</p>}
          <p><b>Bone penetration: {s.bone}.</b> {{ High: "Good odds of breaking through a deer's shoulder blade with this setup.",
            Moderate: "May break through the shoulder blade, but heavy bone can stop or deflect it.",
            Low: "Expect heavy shoulder bone to stop or deflect the arrow — avoid quartering-toward and on-the-shoulder shots." }[s.bone] || ""}</p>
          <div className="hours-grid three"><span className="muted">Distance</span><span className="muted">Flight time</span><span className="muted">Sound reaches deer</span>
            {[10, 20, 30, 40].map((y) => <Frag key={y} a={`${y} yd`} b={`${flightTime(s.fps, y).toFixed(2)} s`} c={`${((y * 3) / 1125).toFixed(2)} s`} />)}</div>
          <p className="muted small">A relaxed deer hearing the shot can start to drop/turn within ~0.1–0.3 s — the longer the flight time, the more it can "jump the string". Estimates use standard rules of thumb from the IBO/ATA rating; a chronograph reading is more accurate.</p>
          {gear.active === cur.id ? <p className="ok small">✓ Active setup — used on the Shot & Recovery page.</p>
            : <button className="btn wide" onClick={() => put({ ...gear, active: cur.id }, `${cur.name} is now active`)}>Use “{cur.name}” on the Shot page</button>}
        </section>
      )}
      {cur && !s && <p className="muted small">Enter the rated speed (or a chronograph speed), draw weight and arrow weight to see the numbers.</p>}

      <section className="card form">
        <label className="field"><span>Name</span><input value={f.name} onChange={txt("name")} /></label>
        <div className="grid2">
          <label className="field half"><span>Type</span><select value={f.bow_type} onChange={txt("bow_type")}>{BOW_TYPES.map((b) => <option key={b}>{b}</option>)}</select></label>
          <label className="field half"><span>Bow make / model</span><input value={f.bow_model} onChange={txt("bow_model")} /></label>
          <label className="field half"><span>{f.bow_type === "Crossbow" ? "Rated speed (fps)" : "IBO / ATA speed (fps)"}</span><NumInput empty min={0} max={2000} value={f.rated_fps} onChange={num("rated_fps")} /></label>
          {f.bow_type === "Crossbow" && <label className="field half"><span>Bolt weight for rated speed (gr)</span><NumInput empty min={0} max={2000} value={f.rated_bolt_gr} onChange={num("rated_bolt_gr")} /></label>}
          <label className="field half"><span>Draw weight (lb)</span><NumInput empty min={0} max={2000} value={f.draw_weight} onChange={num("draw_weight")} /></label>
          <label className="field half"><span>Draw length (in)</span><NumInput empty decimals min={0} max={40} value={f.draw_length} onChange={num("draw_length")} /></label>
          <label className="field half"><span>Arrow / bolt</span><input value={f.arrow_model} onChange={txt("arrow_model")} /></label>
          <label className="field half"><span>Total arrow weight incl. tip (gr)</span><NumInput empty min={0} max={2000} value={f.arrow_gr} onChange={num("arrow_gr")} /></label>
          <label className="field half"><span>Arrow length (in) — nock throat to end of shaft</span><NumInput empty decimals min={0} max={40} value={f.arrow_len ?? ""} onChange={num("arrow_len")} /></label>
          <label className="field half"><span>Balance point (in from nock throat, tip on)</span><NumInput empty decimals min={0} max={40} value={f.balance_in ?? ""} onChange={num("balance_in")} /></label>
          <div className="field half foc-out"><span>FOC</span>{(() => { const p = foc(+f.arrow_len, +f.balance_in);
            return p == null ? <span className="muted small">{f.arrow_len && f.balance_in ? "Balance point must be less than the arrow length" : "Enter length and balance point"}</span>
              : <><b className="big">{p.toFixed(1)}%</b><span className="muted small">{focClass(p)}</span></>; })()}</div>
          <label className="field half"><span>Tip</span><select value={f.tip_type} onChange={txt("tip_type")}>{Object.keys(TIP_FACTOR).map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field half"><span>Broadhead / point weight (gr)</span><NumInput empty min={0} max={500} value={f.tip_gr ?? ""} onChange={num("tip_gr")} /></label>
          <label className="field half"><span>Broadhead make / cut</span><input placeholder='e.g. 1-3/16" cut' value={f.tip_model} onChange={txt("tip_model")} /></label>
          <label className="field half"><span>String accessories (gr)</span><NumInput empty min={0} max={2000} value={f.string_gr} onChange={num("string_gr")} /></label>
          <label className="field half"><span>Chronograph fps (optional)</span><NumInput empty min={0} max={2000} value={f.chrono_fps ?? ""} onChange={num("chrono_fps")} /></label>
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={saveSetup}>Save setup</button>
          {cur && <button className="btn" onClick={async () => { const rest = gear.setups.filter((x) => x.id !== cur.id); if (await put({ setups: rest, active: rest[0]?.id || null }, "Setup deleted")) setPick(rest[0]?.id || NEW); }}>Delete</button>}
        </div>
      </section>
    </>
  );
}
const Frag = ({ a, b, c }) => <><span>{a}</span><span>{b}</span><span>{c}</span></>;

// ================================================================ regulations
function RegsPage({ ground }) {
  const home = ground?.home || { lat: 37.3006, lon: -86.0608, state: "KY" };
  const [place, setPlace] = useState(null);
  useEffect(() => { countyFor(home.lat, home.lon).then(setPlace).catch(() => setPlace({ county: null, state: home.state })); }, [home.lat, home.lon]);
  const state = place?.state || home.state;
  const mod = REG_DATA.curated[state];
  const counties = useMemo(() => (mod ? Object.keys(mod.zones).sort() : []), [mod]);
  const key = `deercast.regsCounty.${ground?.id}`;
  const detected = normalizeCounty(place?.county);
  const [county, setCounty] = useState(null);
  useEffect(() => { if (!mod) return; const saved = localStorage.getItem(key); setCounty(counties.includes(saved) ? saved : counties.includes(detected) ? detected : counties.includes("Hart") ? "Hart" : counties[0]); }, [mod, detected, key]);
  if (!place) return <p className="muted">Finding the county…</p>;
  if (!mod) {
    const [name, agency] = REG_DATA.agencies[state] || [state || "this state", "your state wildlife agency"];
    const q = encodeURIComponent(`${name} deer hunting regulations ${new Date().getFullYear()} ${agency}`);
    return (
      <section className="card">
        <p>Detailed regulations are built in for Kentucky so far. For <b>{name}</b>, use the official source: <b>{agency}</b>.</p>
        <a className="btn wide" href={`https://www.google.com/search?q=${q}`} target="_blank" rel="noreferrer">Find official {name} deer regulations</a>
        <p className="muted small">Want this state built in? Add it to the punch list.</p>
      </section>
    );
  }
  if (!county) return null;
  const zone = mod.zones[county], inCwd = mod.cwdCounties.includes(county);
  const tz = "America/Chicago", today = dateKey(Date.now(), tz);
  const rows = mod.seasons.filter(([n]) => !(n.startsWith("CWD") && !inCwd)).map(([n, s, e, note]) => ({
    n, s, e, note, status: today < s ? `Opens in ${daysBetween(today, s)} days` : today <= e ? "OPEN" : "Closed" }));
  const fmt = (k, y) => new Date(`${k}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", ...(y ? { year: "numeric" } : {}) });
  const a = dailyAstro(home.lat, home.lon, [today], tz)[today];
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz });
  return (
    <>
      <label className="field"><span>County {detected && detected !== county ? `(detected ${detected})` : ""}</span>
        <select value={county} onChange={(e) => { setCounty(e.target.value); localStorage.setItem(key, e.target.value); }}>{counties.map((c) => <option key={c}>{c}</option>)}</select></label>
      <section className="card">
        <div className="stats">
          <div><span className="big">{county}</span><span className="label">County</span></div>
          <div><span className="big">Zone {zone}</span><span className="label">Deer zone</span></div>
          <div><span className="big">{inCwd ? "Yes" : "No"}</span><span className="label">CWD zone</span></div>
        </div>
        <p className="muted small">{mod.state} {mod.season} season · data verified {fmt(mod.verified, true)} · always confirm in the official guide.</p>
        {a.sunrise && <p><b>Legal shooting hours today:</b> {clock(a.sunrise - 30 * 60000)} – {clock(a.sunset + 30 * 60000)} <span className="muted small">(sunrise {clock(a.sunrise)}, sunset {clock(a.sunset)})</span></p>}
      </section>
      <section className="card">
        <span className="h2">Season dates</span>
        {rows.map((r) => (
          <div key={r.n} className="rank-row">
            <div style={{ flex: 1, minWidth: 0 }}><div className="name">{r.n}</div><div className="muted small">{fmt(r.s)} – {fmt(r.e, true)} · {r.note}</div></div>
            <span className={`verdict ${r.status === "OPEN" ? "good" : ""}`}>{r.status === "OPEN" ? "Open" : r.status}</span>
          </div>
        ))}
      </section>
      <section className="card">
        <span className="h2">Bag limits — Zone {zone}</span>
        <p><b>Zone {zone}:</b> {mod.zoneBag[String(zone)]}</p>
        {mod.statewide.map(([l, t]) => <p key={l}><b>{l}:</b> {t}</p>)}
      </section>
      {inCwd && (
        <section className="card"><span className="h2">CWD Surveillance Zone rules</span>
          <ul>{mod.cwdRules.map((r) => <li key={r}>{r}</li>)}</ul></section>
      )}
      <section className="card"><span className="h2">Official sources</span>
        <ul>{Object.entries(mod.links).map(([l, u]) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>
        <p className="muted small">Summary for convenience only — not legal advice. Regulations change and WMAs/public lands often have different rules. The official {mod.agency} guide is the final word.</p>
      </section>
    </>
  );
}

// ================================================================ development (admins)
const STATUSES = ["Open", "In progress", "Done", "Won't do"], PRIORITIES = ["High", "Medium", "Low"], CATS = ["Feature", "Bug", "Model", "UI", "Data", "Infra"];
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function DevPage({ db, toast }) {
  const [items, setItems] = useState(null);
  const load = () => db.listPunch().then(setItems).catch((e) => { toast(e.message); setItems([]); });
  useEffect(() => { load(); }, [db]);
  const [show, setShow] = useState(["Open", "In progress"]);
  const [nw, setNw] = useState({ title: "", category: "Feature", priority: "Medium", details: "" });
  const [edit, setEdit] = useState(null);
  const put = async (p, msg) => { try { await db.savePunch(p); toast(msg); load(); return true; } catch (e) { toast(`Couldn't save — ${e.message}`); return false; } };
  if (!items) return <p className="muted">Loading…</p>;
  const view = items.filter((i) => show.includes(i.status)).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || String(a.created).localeCompare(String(b.created)));
  const exportText = [...items].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority))
    .map((i) => `- [${i.status}] (${i.priority}, ${i.category}) ${i.title}${i.details ? ` — ${i.details}` : ""}`).join("\n");
  return (
    <>
      <section className="card">
        <span className="h2">Add punch list item</span>
        <label className="field"><span>Title</span><input value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} /></label>
        <div className="grid2">
          <label className="field half"><span>Category</span><select value={nw.category} onChange={(e) => setNw({ ...nw, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field half"><span>Priority</span><select value={nw.priority} onChange={(e) => setNw({ ...nw, priority: e.target.value })}>{PRIORITIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <label className="field"><span>Details</span><textarea rows="2" value={nw.details} onChange={(e) => setNw({ ...nw, details: e.target.value })} /></label>
        <button className="btn primary wide" onClick={async () => {
          if (!nw.title.trim()) return toast("Title is required");
          if (await put({ id: newId(), title: nw.title.trim(), category: nw.category, priority: nw.priority, status: "Open", details: nw.details, created: stamp(), updated: stamp() }, "Added")) setNw({ title: "", category: "Feature", priority: "Medium", details: "" });
        }}>Add</button>
      </section>
      <div className="filter-row">{STATUSES.map((s) => <button key={s} className={`fchip ${show.includes(s) ? "on" : ""}`} onClick={() => setShow(show.includes(s) ? show.filter((x) => x !== s) : [...show, s])}>{s}</button>)}</div>
      <section className="card">
        {!view.length && <p className="muted small">Nothing here.</p>}
        {view.map((i) => edit?.id === i.id ? (
          <div key={i.id} className="form punch-edit">
            <label className="field"><span>Title</span><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
            <div className="grid3">
              <label className="field"><span>Status</span><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="field"><span>Priority</span><select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{PRIORITIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="field"><span>Category</span><select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
            <label className="field"><span>Details</span><textarea rows="3" value={edit.details || ""} onChange={(e) => setEdit({ ...edit, details: e.target.value })} /></label>
            <div className="btn-row"><button className="btn primary" onClick={async () => { if (await put({ ...edit, updated: stamp() }, "Saved")) setEdit(null); }}>Save</button>
              <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn" onClick={async () => { try { await db.deletePunch(i.id); setEdit(null); load(); toast("Deleted"); } catch (e) { toast(e.message); } }}>Delete</button></div>
          </div>
        ) : (
          <button key={i.id} className="punch" onClick={() => setEdit({ ...i })}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name">{i.title}</div>
              <div className="muted small">{i.status} · {i.priority} · {i.category}{i.details ? ` — ${i.details}` : ""}</div>
            </div>
            <Icon name="edit" size={18} />
          </button>
        ))}
        <p className="muted small">{items.length} items · {items.filter((i) => i.status === "Done").length} done · tap an item to edit it</p>
      </section>
      <details className="more-box"><summary>Export for a new Claude session</summary>
        <pre className="export">{exportText || "(empty)"}</pre>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(exportText).then(() => toast("Copied"))}>Copy</button>
      </details>
    </>
  );
}
