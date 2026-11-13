import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import NumInput from "./NumInput.jsx";
import { normalizeTrack } from "./TrackMode.jsx";
import { shotSighting } from "./lib/huntmap.js";
import PhotoStrip from "./Photos.jsx";
import { allPaths } from "./lib/photos.js";
import { defaultWeaponId, findWeapon, weaponIdFor, weaponOptions } from "./lib/gear.js";
import { GroundChip, ThemeButton } from "./Shell.jsx";
import { CARDINALS_8, degToCardinal } from "./lib/geo.js";
import { newId, nowIso } from "./lib/db.js";
import { ACTIVITIES, BANDS, KINDS, deerText, isCamera, groupSightings, isoLocal, sessionHours, validation, whereText, withPosition } from "./lib/huntlog.js";
import { fetchForecast, fetchRange } from "./lib/weather.js";
import { myLocation } from "./lib/places.js";
import { scoreForecast } from "./lib/model/scoring.js";
import { dailyAstro } from "./lib/model/astro.js";
import { rutPeakFor } from "./lib/model/rut.js";
import { addDays, dateKey, daysBetween, midnight, parts } from "./lib/model/tz.js";

export const MODEL_VERSION = "web-0.8";
const BAIT_TYPES = new Set(["feeder", "corn_shelled", "corn_ear", "food_other"]);
const BAIT_LABEL = { feeder: "feeder", corn_shelled: "shelled corn", corn_ear: "ear corn", food_other: "other food" };
const tone = (s) => Math.min(4, Math.floor(s / 2));
const pad = (n) => String(n).padStart(2, "0");
const timeOf = (ms, tz) => { const p = parts(ms, tz); return `${pad(p.h)}:${pad(p.mi)}`; };
const atLocal = (key, hhmm, tz) => { const [h, m] = hhmm.split(":").map(Number); const t = midnight(key, tz) + (h * 60 + m) * 60000; return t; };
const fmtClock = (ms, tz) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz });
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = (ms, tz) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz });

// ---------------------------------------------------------------- scoring a sit (same as log.py scored_day/build_hunt)
const dayCache = new Map();
async function scoredDay(lat, lon, key, rutPeak) {
  const ck = `${lat.toFixed(3)},${lon.toFixed(3)},${key},${rutPeak}`;
  if (dayCache.has(ck)) return dayCache.get(ck);
  const fc = await fetchForecast(lat, lon);
  const today = dateKey(Date.now(), fc.tz);
  const w = daysBetween(key, today) <= 1 ? fc : await fetchRange(lat, lon, addDays(key, -1), key);
  const v = { tz: w.tz, scored: scoreForecast(w.rows, lat, lon, w.tz, { rutPeak, start: midnight(key, w.tz), today }) };
  dayCache.set(ck, v);
  return v;
}

/** view "live" = the Hunt tab (the sit in progress, open tracks); "history" = More → Hunt history (past hunts, forecast check). */
export default function HuntLogScreen({ db, me, ground, data, demo, theme, save, toast, onMenu, active: shown, openTrack, openAnalysis, openHuntMap, shotsV,
  view = "live", onBack, openHistory }) {
  const isHistory = view === "history";
  useEffect(() => { document.querySelector(".page.hunt-log")?.scrollTo(0, 0); }, [view]);
  const home = ground?.home || { lat: 37.3006, lon: -86.0608, state: "KY" };
  const stands = data?.stands || [];
  const baits = (data?.features || []).filter((f) => BAIT_TYPES.has(f.type));
  const baitNames = baits.map((b) => b.name || BAIT_LABEL[b.type]);
  const cameras = (data?.features || []).filter((f) => f.type === "camera");
  // my shots, so each sit shows the shots taken during it (shots are edited on the Shot tab → reload when shown)
  const [shots, setShots] = useState([]);
  const loadShots = () => db.listShots().then(setShots).catch(() => setShots([]));
  useEffect(() => { if (shown) loadShots(); }, [db, shown, shotsV]);
  const shotsFor = (id) => shots.filter((x) => x.hunt_id === id).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const recovered = (h) => !!h.harvest || shotsFor(h.id).some((x) => x.result === "recovered");
  const [shotForm, setShotForm] = useState(null); // { huntId, stand, day, time, … id? } — the "I took a shot" form
  const standOf = (x) => (x.from_lat != null ? [x.from_lat, x.from_lon] : coords(x.stand || ""));
  const centerFor = (x) => {
    const hp = (x.pins || []).find((p) => p.kind === "hit");
    if (hp) return [hp.lat, hp.lon];
    if (x.hit_lat != null) return [x.hit_lat, x.hit_lon];
    return standOf(x);
  };
  const huntWeaponFields = (id) => { const o = id && findWeapon(gear, id); return o ? { weapon_id: id, weapon: o.weapon, weapon_kind: o.kind, setup: o.setup?.name || null } : {}; };
  const huntWeapon = (id) => { const h = live?.id === id ? live : mine.find((x) => x.id === id); return defaultWeaponId(gear, h?.weapon_id || wid); };
  const weaponFields = (id) => { const o = findWeapon(gear, id); return { weapon_id: id, weapon: o?.weapon || "Bow", weapon_kind: o?.kind || "bow", setup: o?.setup?.name || null }; };
  const saveShotBasics = async (f) => {
    const cur = f.id ? shots.find((x) => x.id === f.id) : null;
    const rec = { ...(cur || { id: newId(), created: nowIso(), trips: [], pins: [] }), hunt_id: f.huntId, ground_id: ground.id, status: f.status,
      result: f.status === "hit" ? cur?.result || "tracking" : null, time: `${f.day} ${f.time}`, time_iso: new Date(`${f.day}T${f.time}`).toISOString(),
      stand: f.stand, ...weaponFields(f.weapon_id), distance_yd: f.dist, deer: f.deer || "", notes: f.notes, updated: nowIso() };
    const hunt = live?.id === f.huntId ? live : mine.find((h) => h.id === f.huntId);
    if (f.stand !== "Current location") [rec.from_lat, rec.from_lon] = coords(f.stand);
    else if (cur?.from_lat == null || cur?.stand !== "Current location") {
      // where the phone was: the sit's saved spot, else where tracking began, else the property's home spot
      const p0 = normalizeTrack(rec).trips.find((t) => t.path?.length)?.path[0];
      [rec.from_lat, rec.from_lon] = hunt?.lat != null && hunt.stand === "Current location" ? [hunt.lat, hunt.lon] : p0 ? [p0[0], p0[1]] : ptOf(f.stand, hunt);
    }
    const ok = await save((d) => d.saveShot(rec), { reload: "none", ok: f.status === "hit" ? "Shot saved — let it lie before you track" : "Miss logged" });
    if (ok) { await loadShots(); setShotForm(null); if (!cur && f.status === "hit") openAnalysis(rec.id); } // a new hit → straight into shot placement
    return ok;
  };
  const delShot = async (id) => { if (await save((d) => d.deleteShot(id), { reload: "none", ok: "Shot deleted" })) loadShots(); };
  /** Shots of one hunt, each at its stage (missed / waiting / tracking / paused / done), + "I took a shot". */
  const shotPanel = (huntId, stand, defaultMs, deerOpts, isLive) => (
    <div className="shots-box">
      {shotsFor(huntId).map((x) => shotForm?.id === x.id
        ? <ShotQuick key={x.id} initial={shotForm} deerOpts={deerOpts} whereOptions={whereOptions} wOpts={wOpts} onSave={saveShotBasics} onCancel={() => setShotForm(null)} />
        : <ShotStage key={x.id} x={x} live={isLive}
            onEdit={() => { const [day, time] = String(x.time).split(" "); setShotForm({ id: x.id, huntId, stand: x.stand || stand, day, time, status: x.status, weapon_id: weaponIdFor(gear, x), dist: x.distance_yd || 20, deer: x.deer || "", notes: x.notes || "" }); }}
            onDelete={() => delShot(x.id)} onAnalysis={() => openAnalysis(x.id)}
            onTrack={(gps) => openTrack(x, centerFor(x), gps, standOf(x), shotSighting(live?.id === huntId ? live : mine.find((h) => h.id === huntId), x))} />)}
      {shotForm && !shotForm.id && shotForm.huntId === huntId
        ? <ShotQuick initial={shotForm} deerOpts={deerOpts} whereOptions={whereOptions} wOpts={wOpts} onSave={saveShotBasics} onCancel={() => setShotForm(null)} />
        : <button className="btn wide" onClick={() => { const d = new Date(defaultMs()); setShotForm({ huntId, stand, day: localDay(d), time: localHM(d), status: "hit", weapon_id: huntWeapon(huntId), dist: 20, deer: "", notes: "" }); }}>🎯 I took a shot</button>}
    </div>
  );
  const mine = useMemo(() => (data?.hunts || []).filter((h) => !h.owner || h.owner === db.email)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start)), [data, db.email]);
  // Hunt history can also show the other hunters' sits on this ground (read-only); admins also get their shots
  const everyone = useMemo(() => [...(data?.hunts || [])].sort((a, b) => Date.parse(b.start) - Date.parse(a.start)), [data]);
  const hasOthers = everyone.length > mine.length;
  const [who, setWho] = useState(() => localStorage.getItem("deercast.historyWho") || "mine");
  const showAll = hasOthers && who === "all";
  const listed = showAll ? everyone : mine;
  const isMine = (h) => !h.owner || h.owner === db.email;
  const [names, setNames] = useState({});
  const [otherShots, setOtherShots] = useState([]);
  useEffect(() => {
    if (!shown || !isHistory || !showAll) return;
    db.listUsers().then((us) => setNames(Object.fromEntries(us.map((u) => [u.email, u.name || u.email])))).catch(() => {});
    (db.listGroundShots ? db.listGroundShots(ground.id) : Promise.resolve([])).then((xs) => setOtherShots(xs.filter((x) => x.owner && x.owner !== db.email))).catch(() => setOtherShots([]));
  }, [shown, isHistory, showAll, ground?.id, shotsV]);
  const shotsOf = (h) => (isMine(h) ? shotsFor(h.id) : otherShots.filter((x) => x.hunt_id === h.id && x.owner === h.owner));
  const [tz, setTz] = useState("America/Chicago");
  useEffect(() => { fetchForecast(home.lat, home.lon).then((f) => setTz(f.tz)).catch(() => {}); }, [home.lat, home.lon]);

  const whereOptions = ["Current location", ...stands.map((s) => `Stand: ${s.name}`)];
  const coords = (label) => { const s = stands.find((x) => `Stand: ${x.name}` === label); return s ? [s.lat, s.lon] : [home.lat, home.lon]; };
  // "Current location" = where the phone was when the sit started (saved on the sit/hunt), not the property's home spot
  const ptOf = (label, at) => (label === "Current location" && at?.lat != null ? [at.lat, at.lon] : coords(label));
  const rutFor = (key, lat, lon) => rutPeakFor(key, lat, lon, home.state, localStorage.getItem("deercast.rutOverride"));

  async function buildHunt(where, startMs, endMs, sightings, notes, harvest, id, at) {
    const [lat, lon] = ptOf(where, at);
    const rec = { id: id || newId(), date: dateKey(startMs, tz), stand: where, lat, lon, start: isoLocal(startMs, tz), end: isoLocal(endMs, tz),
      sightings, notes, harvest, hours: [], model: MODEL_VERSION, ground_id: ground.id };
    // cameras were being checked this sit → stands with a camera next to them count these hours as watched (Best stand)
    if (sightings.some(isCamera)) rec.cam_stands = [...new Set(cameras.map((c) => stands.find((x) => x.id === c.stand_id)).filter(Boolean).map((x) => `Stand: ${x.name}`))];
    try {
      const { scored, tz: wtz } = await scoredDay(lat, lon, rec.date, rutFor(rec.date, lat, lon));
      rec.hours = sessionHours(startMs, endMs, scored, sightings, wtz, where);
      const h0 = scored.find((r) => r.time === Math.floor(startMs / 3600e3) * 3600e3);
      if (h0) rec.weather = { temp_f: Math.round(h0.temp_f), wind_mph: Math.round(h0.wind_mph), wind_from: degToCardinal(h0.wind_dir),
        pressure_inhg: Math.round(h0.pressure_inhg * 100) / 100, moon: h0.moonName };
    } catch { toast("Saved without forecast scores (no weather) — use Re-score later"); }
    return rec;
  }

  // ---------------------------------------------------------------- live sit
  const [live, setLive] = useState(undefined);
  useEffect(() => {
    db.getDoc("active_hunt", null).then((v) => {
      if (v && !v.id) { v = { ...v, id: newId() }; db.putDoc("active_hunt", v).catch(() => {}); } // sits started before shots could be linked
      setLive(v);
    }).catch(() => setLive(null));
  }, [db]);
  useEffect(() => { if (shotsV) db.getDoc("active_hunt", null).then((v) => setLive((cur) => (v?.id && cur?.id === v.id ? v : cur))).catch(() => {}); }, [shotsV]);
  const putLive = async (v) => { setLive(v); try { await db.putDoc("active_hunt", v); } catch (e) { toast(`Couldn't save — ${e.message}`); } };
  // A recovered deer is always a deer seen: if the sit has no sighting near the shot, add one (once per shot).
  const seenDone = useRef(new Set());
  useEffect(() => {
    (async () => {
      for (const x of shots) {
        if (x.result !== "recovered" || x.seen_logged || seenDone.current.has(x.id)) continue;
        const isLive = live?.id === x.hunt_id, hunt = isLive ? live : mine.find((h) => h.id === x.hunt_id);
        if (!hunt) continue;
        seenDone.current.add(x.id);
        const shotMs = Date.parse(x.time_iso || "");
        const near = (hunt.sightings || []).some((sg) => !isCamera(sg) && Math.abs(Date.parse(sg.time) - shotMs) <= 2 * 3600e3);
        if (!x.deer && !near && Number.isFinite(shotMs)) {
          const sex = normalizeTrack(x).recovery?.sex;
          const kind = sex === "Doe" ? { kind: "Doe" } : sex === "Button buck" ? { kind: "Fawn", fawn: "buck" } : sex === "Buck" ? { kind: "Buck" } : { kind: "Unknown" };
          const sg = { ...kind, count: 1, activity: "", bait: "", notes: "Added from the recovered deer", group: newId(), time: isoLocal(shotMs, tz) };
          const sightings = [...(hunt.sightings || []), sg].sort((a, b) => String(a.time).localeCompare(String(b.time)));
          if (isLive) { const cur = await db.getDoc("active_hunt", null).catch(() => null); await putLive({ ...(cur?.id === live.id ? cur : live), sightings }); }
          else {
            const r = await buildHunt(hunt.stand, Date.parse(hunt.start), Date.parse(hunt.end), sightings, hunt.notes || "", true, hunt.id, hunt);
            await save((d) => d.saveHunt({ ...hunt, ...r }), { reload: "data" });
          }
          toast(`Added the ${sg.kind === "Fawn" ? "button buck" : sg.kind.toLowerCase()} you recovered to this hunt's deer seen`);
        }
        await db.saveShot({ ...x, seen_logged: true }).catch(() => {});
      }
    })().catch(() => {});
  }, [shots, live?.id, mine]);
  const [where, setWhere] = useState(whereOptions[1] || whereOptions[0]);
  // your bows + guns (More → Bow setup / Gun setup): pick what you're hunting with; shots default to it
  const [gear, setGear] = useState(null);
  useEffect(() => { if (shown) db.getDoc("gear", { setups: [], active: null }).then(setGear).catch(() => setGear(null)); }, [db, shown]);
  const wOpts = weaponOptions(gear);
  const [weaponId, setWeaponId] = useState(null);
  const wid = defaultWeaponId(gear, weaponId);
  useEffect(() => { if (stands.length && where === "Current location") setWhere(`Stand: ${stands[0].name}`); }, [stands.length]);
  const [notes, setNotes] = useState("");
  useEffect(() => { setNotes(live?.notes || ""); }, [live?.id, live?.start]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // each sighting is saved to the sit the moment you tap Save (survives closing the app)
  const addLive = async (recs) => { await putLive({ ...live, notes, sightings: [...live.sightings, ...recs] }); toast(`Saved — ${deerText(recs.map((r) => [r.kind, r.count]))}`); return true; };
  const retime = (list, idx, hhmm, key) => list.map((x, i) => (idx.includes(i) ? { ...x, time: isoLocal(atLocal(key, hhmm, tz), tz) } : x));
  const [busy, setBusy] = useState(false);
  const liveCoords = ptOf(live?.where || where, live);
  const [nowFc, setNowFc] = useState(null);
  useEffect(() => {
    if (!live || !shown) return;
    const [lat, lon] = liveCoords, key = dateKey(Date.now(), tz);
    scoredDay(lat, lon, key, rutFor(key, lat, lon)).then(({ scored }) => {
      const h = Math.floor(Date.now() / 3600e3) * 3600e3;
      setNowFc(scored.filter((r) => r.time >= h && r.time <= h + 2 * 3600e3).map((r) => r.score));
    }).catch(() => setNowFc(null));
  }, [live?.where, live?.start, shown, tz]);

  const [endAsk, setEndAsk] = useState(null); // "HH:MM" when a sit ran long (forgot to end it / tracked overnight)
  const LONG_SIT_H = 5;
  const endLive = async (endAt) => {
    const startMs = Date.parse(live.start);
    if (!endAt && Date.now() - startMs > LONG_SIT_H * 3600e3) {
      const t = targets(...liveCoords, startMs);
      const guess = Math.min(Date.now(), startMs < t.sunrise + (t.sunset - t.sunrise) / 2 ? t.sunrise + 4 * 3600e3 : t.legalEnd);
      return setEndAsk({ date: dateKey(guess, tz), time: timeOf(guess, tz) });
    }
    setBusy(true); setEndAsk(null);
    const endMs = Math.max(endAt ?? Math.floor(Date.now() / 60000) * 60000, startMs + 60000);
    const rec = { ...(await buildHunt(live.where, startMs, endMs, live.sightings, notes, recovered({ id: live.id }), live.id, live)), ...huntWeaponFields(live.weapon_id),
      ...(live.photos?.length ? { photos: live.photos } : {}) };
    if (await save((d) => d.saveHunt(rec), { ok: "Hunt saved — ready for the next one." })) {
      await putLive(null); setNotes("");
    }
    setBusy(false);
  };

  // ---------------------------------------------------------------- validation + log
  const v = useMemo(() => validation(mine), [mine]);
  const missing = mine.filter((h) => !(h.hours || []).length);
  const [openId, setOpenId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [pastOpen, setPastOpen] = useState(false);

  const rescore = async () => {
    setBusy(true);
    for (const h of missing) {
      const r = await buildHunt(h.stand, Date.parse(h.start), Date.parse(h.end), h.sightings || [], h.notes || "", !!h.harvest, h.id, h);
      await save((d) => d.saveHunt({ ...h, hours: r.hours, weather: r.weather, model: r.model }), { reload: "none" });
    }
    await save(async () => {}, { ok: "Re-scored" });
    setBusy(false);
  };

  const today = dateKey(Date.now(), tz);
  const targets = (lat, lon, ms) => {
    const a = dailyAstro(lat, lon, [dateKey(ms, tz)], tz)[dateKey(ms, tz)];
    return { legalStart: a.sunrise - 30 * 60000, sunrise: a.sunrise, sunset: a.sunset, legalEnd: a.sunset + 30 * 60000 };
  };

  return (
    <div className="page hunt-log" style={{ display: shown ? undefined : "none" }}>
      <header className="page-top">
        {isHistory ? <button className="chip" onClick={onBack}><Icon name="chev" size={16} style={{ transform: "rotate(90deg)" }} /><span>More</span></button>
          : <GroundChip ground={ground} onClick={onMenu} demo={demo} />}
        <span className="spacer" />
        <ThemeButton theme={theme} />
      </header>
      <div className="page-title"><span className="label">{ground?.name}</span><h1>{isHistory ? "Hunt history" : "Hunt"}</h1></div>
      {!isHistory && <>

      {/* ------------------------------------------------ open tracks: deer hit but not yet recovered */}
      {shots.filter((x) => x.status === "hit" && (!x.result || x.result === "tracking")).map((x) => {
        const n = normalizeTrack(x), t = n.trips[n.trips.length - 1];
        return (
          <section key={x.id} className="card open-track">
            <span className="h2">🩸 Open track</span>
            <p className="small">Shot {x.time}{x.stand ? ` from ${x.stand.replace("Stand: ", "")}` : ""} · {x.outcome}</p>
            {t ? <p className="muted small">Trip {n.trips.length} {t.end ? `ended ${fmtDay(Date.parse(t.end), tz)} ${fmtClock(Date.parse(t.end), tz)}` : "still open"}{t.stopped ? ` — ${t.stopped.toLowerCase()}` : ""}{t.notes ? `. ${t.notes}` : ""} · {n.pins.length} pin{n.pins.length === 1 ? "" : "s"}</p>
              : <p className="muted small">No tracking trips logged yet.</p>}
            <div className="btn-row">
              <button className="btn primary" onClick={() => openTrack(x, centerFor(x), true, standOf(x))}>▶ Pick up the track</button>
              <button className="btn" onClick={() => openTrack(x, centerFor(x), false, standOf(x))}>🗺️ Map / edit</button>
            </div>
          </section>
        );
      })}

      {/* ------------------------------------------------ in the stand */}
      <section className="card">
        <span className="h2">In the stand</span>
        {live === undefined && <p className="muted">Loading…</p>}
        {live === null && (
          <>
            <label className="field"><span>Where</span>
              <select value={where} onChange={(e) => setWhere(e.target.value)}>
                {whereOptions.map((o) => <option key={o} value={o}>{o.replace("Stand: ", "")}</option>)}
              </select>
            </label>
            <label className="field"><span>Hunting with</span>
              <select value={wid} onChange={(e) => setWeaponId(e.target.value)}>{wOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
            <HuntClock start={null} t={targets(...coords(where), Date.now())} tz={tz} />
            <button className="btn primary wide" disabled={busy} onClick={async () => {
              const start = isoLocal(Math.floor(Date.now() / 60000) * 60000, tz);
              let at = {};
              if (where === "Current location") {
                setBusy(true);
                try { const p = await myLocation(); at = { lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 }; }
                catch { toast("Couldn't get your location — using the property's home spot"); }
                setBusy(false);
              }
              putLive({ id: newId(), where, start, sightings: [], notes: "", weapon_id: wid, ...at });
            }}>
              Start hunt now
            </button>
          </>
        )}
        {live && (
          <>
            <div className="live-head"><b>{live.where.replace("Stand: ", "")}</b><span className="muted"> · since {fmtClock(Date.parse(live.start), tz)}</span></div>
            <HuntClock start={Date.parse(live.start)} t={targets(...liveCoords, Date.parse(live.start))} tz={tz} />
            {live.weapon_id && findWeapon(gear, live.weapon_id) && <p className="muted small">Hunting with {findWeapon(gear, live.weapon_id).label}</p>}
            {nowFc && nowFc.length > 0 && (
              <div className="muted small">Forecast this hour <b style={{ color: `var(--s${tone(nowFc[0])}-text)` }}>{nowFc[0].toFixed(1)}</b>
                {nowFc.length > 1 && <> · next hours {nowFc.slice(1).map((x) => x.toFixed(1)).join(" → ")}</>}</div>
            )}
            <div className="sub-h">Deer seen</div>
            <SightingCard baitNames={baitNames} anchor={liveCoords} cameras={cameras} stands={stands} tz={tz} dayKey={dateKey(Date.parse(live.start), tz)} onSave={addLive} />
            <SightingList sightings={live.sightings} tz={tz} onRemove={(idx) => putLive({ ...live, notes, sightings: live.sightings.filter((_, i) => !idx.includes(i)) })}
              onRetime={(idx, hhmm) => putLive({ ...live, notes, sightings: retime(live.sightings, idx, hhmm, dateKey(Date.parse(live.start), tz)) })}
              onShot={(e) => { const d = new Date(Date.parse(e.time)); setShotForm({ huntId: live.id, stand: live.where, day: localDay(d), time: localHM(d), status: "hit", weapon_id: huntWeapon(live.id), dist: 20, deer: deerText(e.deer), notes: "" }); }} />
            {!live.sightings.length && <p className="muted small">Nothing saved yet. Each sighting is saved to this sit as soon as you tap Save.</p>}
            <div className="sub-h">Photos</div>
            <PhotoStrip db={db} photos={live.photos || []} sightings={live.sightings} groundId={ground.id} tz={tz} live toast={toast}
              onChange={async (photos) => { const v = { ...live, notes, photos }; await db.putDoc("active_hunt", v); setLive(v); }} />
            {shotPanel(live.id, live.where, () => Date.now(), groupSightings(live.sightings).map((g) => deerText(g.deer)), true)}
            <label className="field"><span>Notes for this sit</span><textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (live.notes || "") && putLive({ ...live, notes })} /></label>
            <div className="btn-row">
              <button className="btn primary" disabled={busy} onClick={() => endLive()}>{busy ? "Saving…" : "End & save hunt"}</button>
              <button className="btn" onClick={() => setConfirmDiscard(true)}>Discard</button>
            </div>
            {endAsk && (
              <div className="confirm">This sit started {fmtClock(Date.parse(live.start), tz)} on {fmtDay(Date.parse(live.start), tz)} — over {LONG_SIT_H} hours ago. When did you climb down?
                <p className="muted small">Tracking afterwards (even the next morning) goes on the shot, not the sit.</p>
                <div className="grid2">
                  <label className="field half"><span>Date</span><input type="date" value={endAsk.date} onChange={(e) => e.target.value && setEndAsk({ ...endAsk, date: e.target.value })} /></label>
                  <label className="field half"><span>Time</span><input type="time" value={endAsk.time} onChange={(e) => e.target.value && setEndAsk({ ...endAsk, time: e.target.value })} /></label>
                </div>
                <div className="btn-row"><button className="btn primary" disabled={busy} onClick={() => endLive(atLocal(endAsk.date, endAsk.time, tz))}>Save with this end time</button>
                  <button className="btn" onClick={() => endLive(Date.now())}>It's really still going — end now</button></div>
              </div>
            )}
            {confirmDiscard && (
              <div className="confirm">Throw away this sit and its sightings{live.photos?.length ? " and photos" : ""}?
                <div className="btn-row"><button className="btn danger" onClick={() => { db.deletePhotos(allPaths(live.photos)).catch(() => {}); putLive(null); setConfirmDiscard(false); setNotes(""); }}>Discard</button>
                  <button className="btn" onClick={() => setConfirmDiscard(false)}>Keep it</button></div>
              </div>
            )}
          </>
        )}
      </section>

      <button className="nav-row card" onClick={openHistory}><Icon name="log" /><span>Hunt history</span>
        <span className="muted small">{mine.length} hunt{mine.length === 1 ? "" : "s"}</span><Icon name="chev" className="icon chev-r" /></button>
      </>}

      {isHistory && <>
      {/* ------------------------------------------------ past hunt */}
      <section className="card">
        <button className="row-toggle" onClick={() => setPastOpen(!pastOpen)}><span className="h2">Add a past hunt</span><Icon name="chev" /></button>
        {pastOpen && <HuntForm key="past" tz={tz} whereOptions={whereOptions} baitNames={baitNames} coords={coords} today={today}
          initial={{ id: newId(), where: whereOptions[1] || whereOptions[0], date: today, start: "06:15", end: "09:30", sightings: [], notes: "", harvest: false, weapon_id: wid }} wOpts={wOpts}
          cameras={cameras} stands={stands} onShotAfter={(id, where, ms) => { setPastOpen(false); setOpenId(id); const d = new Date(ms); setShotForm({ huntId: id, stand: where, day: localDay(d), time: localHM(d), status: "hit", weapon_id: huntWeapon(id), dist: 20, deer: "", notes: "" }); }}
          submitLabel="Save past hunt"
          onSubmit={async (f) => {
            const rec = { ...(await buildHunt(f.where, f.startMs, f.endMs, f.sightings, f.notes, f.harvest || recovered({ id: f.id }), f.id)), ...huntWeaponFields(f.weapon_id) };
            const n = f.sightings.reduce((s, x) => s + (+x.count || 1), 0);
            return save((d) => d.saveHunt(rec), { ok: `Saved the ${fmtDay(f.startMs, tz)} hunt (${n} deer)` });
          }} resetAfter />}
      </section>

      {/* ------------------------------------------------ validation */}
      <section className="card">
        <span className="h2">Does the forecast work?</span>
        {!v.nHours && <p className="muted small">Log a few sits and this compares each hour's forecast score with the deer you actually saw.</p>}
        {v.nHours > 0 && (
          <>
            <div className="stats">
              <div><span className="big">{v.nHunts}</span><span className="label">Sits</span></div>
              <div><span className="big">{v.nHours}</span><span className="label">Hours scored</span></div>
              <div><span className="big">{Number.isNaN(v.rho) ? "—" : `${v.rho >= 0 ? "+" : ""}${v.rho.toFixed(2)}`}</span><span className="label">Score ↔ deer</span></div>
            </div>
            <p><b>{v.verdict}</b></p>
            <BandChart bands={v.bands} />
            <p className="muted small">Deer seen per hour hunted in each forecast-score band (hours hunted underneath). If the forecast works, bars rise left to right. Score ↔ deer: +1 perfect, 0 none, negative backwards.</p>
          </>
        )}
        {missing.length > 0 && <button className="link" disabled={busy} onClick={rescore}>Re-score {missing.length} hunt(s) missing forecast scores</button>}
      </section>

      {/* ------------------------------------------------ log */}
      <section className="card">
        <span className="h2">Hunts ({listed.length})</span>
        {hasOthers && <div className="seg small-seg">{[["mine", "Mine"], ["all", "Everyone on this ground"]].map(([k, l]) =>
          <button key={k} className={(showAll ? "all" : "mine") === k ? "on" : ""} onClick={() => { setWho(k); try { localStorage.setItem("deercast.historyWho", k); } catch { /* ignore */ } }}>{l}</button>)}</div>}
        {!listed.length && <p className="muted small">No hunts on this ground yet.</p>}
        {listed.map((h) => {
          const own = isMine(h);
          const s = Date.parse(h.start), e = Date.parse(h.end);
          const fromStand = (h.sightings || []).filter((x) => !isCamera(x));
          const seen = fromStand.reduce((n, x) => n + (+x.count || 1), 0);
          const bucks = fromStand.filter((x) => x.kind === "Buck").reduce((n, x) => n + (+x.count || 1), 0);
          const onCam = (h.sightings || []).filter(isCamera).reduce((n, x) => n + (+x.count || 1), 0);
          const scores = (h.hours || []).map((x) => x.score).filter((x) => x != null);
          const isOpen = openId === h.id;
          return (
            <div key={h.id} className="hunt">
              <button className="hunt-row" onClick={() => { setOpenId(isOpen ? null : h.id); setEditId(null); setConfirmDel(null); }} aria-expanded={isOpen}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{fmtDay(s, tz)} · {h.stand.replace("Stand: ", "")}{!own && <span className="muted small"> · {names[h.owner] || h.owner}</span>}</div>
                  <div className="muted small">{fmtClock(s, tz)}–{fmtClock(e, tz)} · {seen} deer ({bucks} buck{bucks === 1 ? "" : "s"}){onCam ? ` + ${onCam} on cams` : ""}{shotText(shotsOf(h), h.harvest)}</div>
                </div>
                {scores.length > 0 && <span className="pill" style={{ background: `var(--s${tone(Math.max(...scores))})` }}>{Math.max(...scores).toFixed(1)}</span>}
              </button>
              {isOpen && editId !== h.id && (
                <div className="hunt-body">
                  {scores.length > 0 && <div className="muted small">Forecast during sit: avg {(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}, best {Math.max(...scores).toFixed(1)}</div>}
                  {h.weather && <div className="muted small">{h.weather.temp_f}°F · wind {h.weather.wind_from} {h.weather.wind_mph} mph · {h.weather.pressure_inhg} inHg · {h.weather.moon}</div>}
                  {(h.hours || []).length > 0 && (
                    <div className="hours-grid">
                      <span className="muted">Hour</span><span className="muted">Score</span><span className="muted">Min</span><span className="muted">Deer</span>
                      {h.hours.map((x) => <HourRow key={x.hour} x={x} />)}
                    </div>
                  )}
                  {groupSightings(h.sightings).map((g) => (
                    <div key={g.group} className="small">• {fmtClock(Date.parse(g.time), tz)} — {deerText(g.deer)}{g.source === "camera" ? ` (📷 ${g.camera || "trail cam"})` : ""}{g.activity ? `, ${g.activity}` : ""}{g.bait ? `, at ${g.bait}` : ""}{whereText(g) ? ` (${whereText(g)})` : ""}</div>
                  ))}
                  {h.notes && <p className="small"><i>{h.notes}</i></p>}
                  {h.edited && <div className="muted small">Edited {h.edited}</div>}
                  {(own || (h.photos || []).length > 0) && <PhotoStrip db={db} photos={h.photos || []} sightings={h.sightings || []} groundId={h.ground_id || ground.id} tz={tz} toast={toast}
                    canEdit={own} onChange={async (photos) => { if (!(await save((d) => d.saveHunt({ ...h, photos })))) throw new Error("not saved"); }} />}
                  <button className="btn wide" onClick={() => openHuntMap(h, shotsOf(h), tz)}>🗺️ Map this hunt</button>
                  {own ? shotPanel(h.id, h.stand, () => s, groupSightings(h.sightings).map((g) => deerText(g.deer)), false)
                    : shotsOf(h).map((x) => <div key={x.id} className="small">🎯 {shotStatus(x)}{x.deer ? ` · ${x.deer}` : ""}{x.distance_yd ? ` · ${x.distance_yd} yd` : ""}</div>)}
                  {!own && <p className="muted small">{names[h.owner] || h.owner}'s hunt — only they can change it.</p>}
                  {own && <div className="btn-row">
                    <button className="btn" onClick={() => setEditId(h.id)}>Edit</button>
                    <button className="btn" onClick={() => setConfirmDel(h.id)}>Delete</button>
                  </div>}
                  {confirmDel === h.id && (
                    <div className="confirm">Delete this hunt permanently?
                      <div className="btn-row"><button className="btn danger" onClick={async () => { if (await save((d) => d.deleteHunt(h.id), { ok: "Hunt deleted" })) db.deletePhotos(allPaths(h.photos)).catch(() => {}); }}>Yes, delete</button>
                        <button className="btn" onClick={() => setConfirmDel(null)}>Keep it</button></div>
                    </div>
                  )}
                </div>
              )}
              {isOpen && own && editId === h.id && (
                <div className="hunt-body">
                  <HuntForm key={`ed-${h.id}`} tz={tz} whereOptions={whereOptions.includes(h.stand) ? whereOptions : [...whereOptions, h.stand]}
                    baitNames={baitNames} coords={coords} today={today} submitLabel="Save changes" onCancel={() => setEditId(null)}
                    cameras={cameras} stands={stands}
                    wOpts={wOpts} initial={{ id: h.id, weapon_id: h.weapon_id || null, where: h.stand, date: dateKey(s, tz), start: timeOf(s, tz), end: timeOf(e, tz),
                      sightings: (h.sightings || []).map((x) => ({ ...x })), notes: h.notes || "", harvest: !!h.harvest }}
                    onSubmit={async (f) => {
                      // keep each sighting's clock time, move it to the (possibly new) date, and re-place it from the stand
                      const anchor = coords(f.where);
                      const fixed = f.sightings.map((x) => {
                        const y = { ...x }; delete y.lat; delete y.lon;
                        const t = Date.parse(x.time);
                        // keep a sighting's clock time and its day relative to the sit (overnight sits), moved onto the new date
                        y.time = Number.isNaN(t) ? isoLocal(f.startMs, tz)
                          : isoLocal(atLocal(addDays(f.date, daysBetween(dateKey(s, tz), dateKey(t, tz))), timeOf(t, tz), tz), tz);
                        return withPosition(y, anchor);
                      });
                      const rec = { ...(await buildHunt(f.where, f.startMs, f.endMs, fixed, f.notes, recovered(h), h.id, f.where === h.stand ? h : null)), ...huntWeaponFields(f.weapon_id) };
                      const ok = await save((d) => d.saveHunt({ ...rec, ...(h.photos ? { photos: h.photos } : {}), id: h.id, ground_id: h.ground_id || ground.id, edited: nowIso().slice(0, 16).replace("T", " ") }),
                        { ok: "Hunt updated" });
                      if (ok) setEditId(null);
                      return ok;
                    }} />
                </div>
              )}
            </div>
          );
        })}
      </section>
      </>}
    </div>
  );
}

function HourRow({ x }) {
  const p = String(x.hour).slice(11, 13), h = +p;
  return (<>
    <span>{h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`}</span>
    <span>{x.score == null ? "—" : x.score.toFixed(1)}</span><span>{x.minutes}</span><span>{x.seen}</span>
  </>);
}

function BandChart({ bands }) {
  const max = Math.max(0.5, ...bands.map((b) => b.perHour || 0));
  return (
    <div className="band-chart" role="img" aria-label="Deer per hour by forecast score band">
      {bands.map((b, i) => (
        <div key={b.band} className="band">
          <span className="v">{b.perHour == null ? "—" : b.perHour.toFixed(2)}</span>
          <span className="b" style={{ height: `${8 + ((b.perHour || 0) / max) * 90}px`, background: `var(--s${i})` }} />
          <span className="l">{b.band}</span>
          <span className="muted h">{b.hours.toFixed(1)} h</span>
        </div>
      ))}
    </div>
  );
}

/** Live hunt clock: time on stand (counts up every second) and countdowns to legal light & sunrise (morning)
 *  or sunset & end of legal light (evening). Same rules as deercast/clock.py. */
function HuntClock({ start, t, tz }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const ref = start ?? now;
  const morning = ref < t.sunrise + (t.sunset - t.sunrise) / 2;
  const items = morning ? [["Legal shooting light", t.legalStart, "starts"], ["Sunrise", t.sunrise, "starts"]]
    : [["Sunset", t.sunset, "ends"], ["Legal shooting light", t.legalEnd, "ends"]];
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h > 0 ? `${h}:${pad(m)}` : m}:${pad(s % 60)}`; };
  return (
    <div className="clock">
      {start != null && <div className="up"><span className="muted">On stand</span> <span className="big">{fmt(now - start)}</span></div>}
      {items.map(([label, at, kind]) => {
        const dt = at - now;
        return (
          <div key={label} className="cd">
            <span>{label} <span className="muted">{fmtClock(at, tz)}</span></span>
            <b className={dt <= 0 ? "muted" : dt < 15 * 60000 ? "soon" : ""}>{dt > 0 ? `${kind} in ${fmt(dt)}` : kind === "starts" ? "now legal" : kind === "ends" ? "passed" : ""}</b>
          </div>
        );
      })}
    </div>
  );
}

function WhereFields({ value, onChange }) {
  const sel = (k, label) => (
    <label className="field half"><span>{label}</span>
      <select value={value[k] || ""} onChange={(e) => onChange({ ...value, [k]: e.target.value || null })}>
        <option value="">—</option>{CARDINALS_8.map((c) => <option key={c}>{c}</option>)}
      </select>
    </label>
  );
  return (
    <details className="more-box"><summary>Where (optional)</summary>
      <div className="grid2">
        {sel("dir", "Direction from stand")}
        <label className="field half"><span>Distance (yd)</span>
          <NumInput empty min={0} max={500} value={value.dist_yd} onChange={(v) => onChange({ ...value, dist_yd: v || null })} />
        </label>
        {sel("came_from", "Came from")}
        {sel("went_to", "Went toward")}
      </div>
    </details>
  );
}

function Extras({ act, setAct, bait, setBait }) {
  return (
    <div className="grid2">
      <label className="field half"><span>Doing (optional)</span>
        <select value={act} onChange={(e) => setAct(e.target.value)}><option value="">—</option>{ACTIVITIES.map((a) => <option key={a}>{a}</option>)}</select></label>
      <div className="field half"><span>At a feeder?</span>
        <label className="toggle"><input type="checkbox" checked={!!bait} onChange={(e) => setBait(e.target.checked ? "feeder" : "")} /><span className="track"><span className="knob" /></span><span>{bait ? "Yes" : "No"}</span></label></div>
    </div>
  );
}

const EMPTY_LOC = { dir: null, dist_yd: null, came_from: null, went_to: null };

/** One card for every sighting: source (stand / trail camera), time, how many of each, doing, bait, where → Save.
 *  Each Save is its own entry (deer seen together share a group id); the card resets for the next deer. */
const SIGHT_TYPES = [["Buck", "Buck"], ["Doe", "Doe"], ["Doe fawn", "Fawn", "doe"], ["Button buck", "Fawn", "buck"], ["Fawn (?)", "Fawn", "unknown"], ["Unknown", "Unknown"]];
function SightingCard({ baitNames, anchor, cameras, stands = [], tz, dayKey, defaultTime, onSave }) {
  const zero = Object.fromEntries(SIGHT_TYPES.map(([k]) => [k, 0]));
  const [c, setC] = useState(zero), [act, setAct] = useState(""), [bait, setBait] = useState(""), [loc, setLoc] = useState(EMPTY_LOC);
  const [src, setSrc] = useState("stand"), [cam, setCam] = useState(cameras[0]?.id || "");
  const [time, setTime] = useState(defaultTime || ""); // "" = now (live sit only)
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!cam && cameras.length) setCam(cameras[0].id); }, [cameras.length]);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const camera = cameras.find((x) => x.id === cam);
  const picked = SIGHT_TYPES.filter(([k]) => c[k]).map(([k]) => [k, c[k]]);
  const save = async () => {
    if (!total) return;
    const g = newId();
    const stamp = time ? isoLocal(atLocal(dayKey, time, tz), tz) : isoLocal(Math.floor(Date.now() / 60000) * 60000, tz);
    const near = camera?.stand_id ? stands.find((x) => x.id === camera.stand_id) : null;
    const recs = SIGHT_TYPES.filter(([k]) => c[k]).map(([k, kind, fawn]) => {
      const r = { kind, count: c[k], activity: act, bait, notes: "", group: g, time: stamp, ...(fawn ? { fawn } : {}) };
      if (src === "camera" && camera) return { ...r, source: "camera", camera: camera.name || "Trail camera", near: near ? `Stand: ${near.name}` : null, lat: camera.lat, lon: camera.lon };
      return withPosition({ ...r, ...loc }, anchor);
    });
    setBusy(true);
    const ok = await onSave(recs);
    setBusy(false);
    if (ok !== false) { setC(zero); setLoc(EMPTY_LOC); setAct(""); setBait(""); setTime(defaultTime || ""); }
  };
  return (
    <div className="picker sight-card">
      <div className="seg">
        <button className={src === "stand" ? "on" : ""} onClick={() => setSrc("stand")}>From my stand</button>
        <button className={src === "camera" ? "on" : ""} onClick={() => setSrc("camera")}>📷 On a trail cam</button>
      </div>
      {src === "camera" && (cameras.length
        ? <label className="field"><span>Which camera</span>
            <select value={cam} onChange={(e) => setCam(e.target.value)}>{cameras.map((x, i) => <option key={x.id} value={x.id}>{x.name || `Trail camera ${i + 1}`}</option>)}</select></label>
        : <p className="confirm small">No trail cameras on the map yet. On the Map, tap where a camera is → Add mark → Trail camera. Then pick it here.</p>)}
      <div className="time-row">
        <label className="field"><span>Time seen</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        {defaultTime == null && <button className={`btn sm ${time ? "" : "primary"}`} onClick={() => setTime("")}>Now</button>}
      </div>
      <div className="steppers">
        {SIGHT_TYPES.map(([k]) => (
          <div key={k} className={`stepper ${c[k] ? "on" : ""}`}>
            <span className="label">{k === "Unknown" ? "Unknown" : k === "Fawn (?)" ? "Fawn — not sure" : `${k}s`}</span>
            <div><button aria-label={`fewer ${k}`} onClick={() => setC({ ...c, [k]: Math.max(0, c[k] - 1) })}>−</button>
              <b>{c[k]}</b>
              <button aria-label={`more ${k}`} onClick={() => setC({ ...c, [k]: Math.min(30, c[k] + 1) })}>+</button></div>
          </div>
        ))}
      </div>
      <Extras {...{ act, setAct, bait, setBait, baitNames }} />
      {src === "stand" && <WhereFields value={loc} onChange={setLoc} />}
      <button className="btn primary wide" disabled={!total || busy || (src === "camera" && !camera)} onClick={save}>
        {busy ? "Saving…" : total ? `Save sighting — ${deerText(picked)}` : "Tap + to count deer, then save"}
      </button>
    </div>
  );
}

const RESULT = { tracking: "still tracking", recovered: "recovered", not_found: "not found" };
export const shotStatus = (x) => (x.status === "missed" ? "Missed" : x.status === "hit" ? `Hit — ${RESULT[x.result] || "still tracking"}` : "Shot");
function shotText(list, harvest) {
  if (list.some((x) => x.result === "recovered")) return " · deer recovered";
  if (list.length) return ` · ${list.length === 1 ? shotStatus(list[0]).toLowerCase() : `${list.length} shots`}`;
  return harvest ? " · harvest" : "";
}

function SightingList({ sightings, tz, onRemove, onRetime, onShot }) {
  const groups = groupSightings(sightings);
  if (!groups.length) return null;
  return (
    <div className="sightings">
      {groups.map((e) => (
        <div key={e.group} className="sighting">
          <div style={{ flex: 1, minWidth: 0 }}>
            {onRetime
              ? <input className="time-in" type="time" aria-label="Time seen" value={timeOf(Date.parse(e.time), tz)} onChange={(ev) => ev.target.value && onRetime(e.idx, ev.target.value)} />
              : <b>{fmtClock(Date.parse(e.time), tz)}</b>}
            {" "}— {deerText(e.deer)}{e.source === "camera" ? ` · 📷 ${e.camera || "trail cam"}` : ""}{e.activity ? ` · ${e.activity}` : ""}{e.bait ? ` · at ${e.bait}` : ""}
            {whereText(e) && <div className="muted small">{whereText(e)}</div>}
            {onShot && e.source !== "camera" && <button className="btn sm shot-this" onClick={() => onShot(e)}>🎯 I shot at {e.deer.length === 1 && e.deer[0][1] === 1 ? "this deer" : "one of these"}</button>}
          </div>
          <button className="x" aria-label="Remove" onClick={() => onRemove(e.idx)}><Icon name="x" size={18} /></button>
        </div>
      ))}
    </div>
  );
}

/** Past-hunt entry and inline edit share this form. */
function HuntForm({ initial, tz, whereOptions, baitNames, coords, today, onSubmit, onCancel, submitLabel, resetAfter, cameras, stands, onShotAfter, wOpts = [] }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async () => {
    const startMs = atLocal(f.date, f.start, tz), endMs = atLocal(f.date, f.end, tz);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return setErr("Set the date, start and end times.");
    if (endMs <= startMs) return setErr(`End time must be after start time (both on ${fmtDay(startMs, tz)}). For a sit you forgot to end, set End to when you climbed down.`);
    setErr(""); setBusy(true);
    let ok = false;
    try { ok = await onSubmit({ ...f, startMs, endMs }); } catch (e) { setErr(`Couldn't save — ${e.message}`); }
    setBusy(false);
    if (ok && resetAfter) setF({ ...initial, id: newId(), where: f.where });
    return ok;
  };
  // the hunt is saved first (so the shot has a hunt to link to and nothing typed here is lost), then the Shot page opens
  const shotNow = async () => { const id = f.id, where = f.where, ms = atLocal(f.date, f.start, tz); if (await submit()) onShotAfter(id, where, ms); };
  return (
    <div className="form">
      <label className="field"><span>Where</span>
        <select value={f.where} onChange={set("where")}>{whereOptions.map((o) => <option key={o} value={o}>{o.replace("Stand: ", "")}</option>)}</select></label>
      {wOpts.length > 0 && <label className="field"><span>Hunting with</span>
        <select value={f.weapon_id || ""} onChange={set("weapon_id")}><option value="">— not set —</option>{wOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>}
      <div className="grid3">
        <label className="field"><span>Date</span><input type="date" max={today} value={f.date} onChange={set("date")} /></label>
        <label className="field"><span>Start</span><input type="time" step="300" value={f.start} onChange={set("start")} /></label>
        <label className="field"><span>End</span><input type="time" step="300" value={f.end} onChange={set("end")} /></label>
      </div>
      <div className="sub-h">Deer seen</div>
      <SightingCard key={`${f.date}-${f.start}`} baitNames={baitNames} anchor={coords(f.where)} cameras={cameras} stands={stands} tz={tz} dayKey={f.date} defaultTime={f.start}
        onSave={(recs) => { setF({ ...f, sightings: [...f.sightings, ...recs] }); return true; }} />
      <SightingList sightings={f.sightings} tz={tz} onRemove={(idx) => setF({ ...f, sightings: f.sightings.filter((_, i) => !idx.includes(i)) })}
        onRetime={(idx, hhmm) => setF({ ...f, sightings: f.sightings.map((x, i) => (idx.includes(i) ? { ...x, time: isoLocal(atLocal(f.date, hhmm, tz), tz) } : x)) })} />
      {!f.sightings.length && <p className="muted small">No deer added — that's fine for a sit where you saw nothing.</p>}
      {!onShotAfter && <p className="muted small">Shots for this hunt are listed under it — save, then use 🎯 there.</p>}
      <label className="field"><span>Notes</span><textarea rows="2" value={f.notes} onChange={set("notes")} /></label>
      {err && <div className="err small">{err}</div>}
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : submitLabel}</button>
        {onShotAfter && <button className="btn" disabled={busy} onClick={shotNow}>Save & add a shot</button>}
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shots inside the session
/** "I took a shot": hit or miss, when, which deer, how far. */
function ShotQuick({ initial, deerOpts, whereOptions, wOpts, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <div className="form trip-form shot-quick">
      <div className="sub-h">🎯 {f.id ? "Edit shot" : "I took a shot"}</div>
      <div className="seg big-seg">
        <button className={f.status === "hit" ? "on" : ""} onClick={() => set("status")("hit")}>Hit it</button>
        <button className={f.status === "missed" ? "on" : ""} onClick={() => set("status")("missed")}>Missed</button>
      </div>
      <div className="grid2">
        <label className="field half"><span>Time of shot</span><input type="time" value={f.time} onChange={(e) => e.target.value && set("time")(e.target.value)} /></label>
        <label className="field half"><span>Distance (yd)</span><NumInput min={1} max={400} value={f.dist} onChange={set("dist")} /></label>
        <label className="field half"><span>Shot from</span><select value={f.stand} onChange={(e) => set("stand")(e.target.value)}>
          {[...new Set([...whereOptions, f.stand].filter(Boolean))].map((o) => <option key={o} value={o}>{o.replace("Stand: ", "")}</option>)}</select></label>
        <label className="field half"><span>Weapon</span><select value={f.weapon_id} onChange={(e) => set("weapon_id")(e.target.value)}>{wOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        {deerOpts.length > 0 && <label className="field half"><span>Which deer</span><select value={f.deer} onChange={(e) => set("deer")(e.target.value)}>
          <option value="">—</option>{[...new Set([...deerOpts, f.deer].filter(Boolean))].map((d) => <option key={d}>{d}</option>)}</select></label>}
      </div>
      <label className="field"><span>Notes (optional)</span><input value={f.notes} onChange={(e) => set("notes")(e.target.value)} placeholder={f.status === "hit" ? "reaction, where you think you hit" : "high, low, deflected?"} /></label>
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onSave(f); setBusy(false); }}>{busy ? "Saving…" : f.status === "hit" ? (f.id ? "Save shot" : "Track and recover") : "Save — missed"}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const fmtMin = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`);
/** One shot at its stage: missed · let it lie (timer) · tracking · paused · recovered / not found. */
function ShotStage({ x, onEdit, onDelete, onAnalysis, onTrack }) {
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const n = normalizeTrack(x), t = n.trips[n.trips.length - 1];
  const waiting = x.status === "hit" && (x.result || "tracking") === "tracking" && !n.trips.length;
  useEffect(() => { if (!waiting) return; const i = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(i); }, [waiting]);
  const since = (now - Date.parse(x.time_iso || "")) / 60000;
  const head = (
    <div className="stage-head">🎯 <b>{x.status === "missed" ? "Missed" : "Hit"}</b> · {x.time_iso ? new Date(x.time_iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : String(x.time).slice(11)}{x.deer ? ` · ${x.deer}` : ""}{x.distance_yd ? ` · ${x.distance_yd} yd` : ""}
      {x.status === "hit" && x.outcome && x.outcome !== "Hit — spot not marked" ? <div className="muted small">Hit analysis: {x.outcome}</div> : null}</div>
  );
  const links = (
    <div className="stage-links">
      <button className="link" onClick={onEdit}>Edit shot</button>
      {x.status === "hit" && <button className="link" onClick={onAnalysis}>Hit analysis</button>}
      {confirm ? <button className="link danger-text" onClick={onDelete}>Delete it?</button> : <button className="link" onClick={() => setConfirm(true)}>Delete</button>}
    </div>
  );
  if (x.status === "missed") return <div className="stage">{head}{x.notes && <div className="muted small">{x.notes}</div>}{links}</div>;
  const done = x.result === "recovered" || x.result === "not_found";
  return (
    <div className={`stage ${done ? "" : "open"}`}>
      {head}
      {waiting && (
        <div className="wait">
          {Number.isFinite(since) && since >= 0 && since < 48 * 60 && <div><span className="big">{fmtMin(since)}</span> <span className="muted">since the shot</span></div>}
          {x.wait_min != null
            ? <div className="small">Recommended wait for this hit: <b>{fmtMin(x.wait_min)}</b>{Number.isFinite(since) && since < x.wait_min ? ` — ${fmtMin(x.wait_min - since)} to go` : " — OK to start"}</div>
            : <div className="small">Let it lie: about 30–60 min for a good double-lung hit, 4+ h for liver or if unsure, 8–12 h for a gut hit. <button className="link" onClick={onAnalysis}>Hit analysis</button> gives a wait for your shot.</div>}
          <button className="btn primary wide" onClick={() => onTrack(true)}>▶ Start tracking (records your path)</button>
          <button className="link" onClick={() => onTrack(false)}>Log it on the map without GPS (recreating it later)</button>
        </div>
      )}
      {!waiting && !done && (
        <>
          <div className="small">{t?.end ? `⏸ Paused — trip ${n.trips.length} ended ${new Date(t.end).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}${t.stopped ? ` (${t.stopped.toLowerCase()})` : ""}` : `Tracking — trip ${n.trips.length} is open`} · {n.pins.length} pin{n.pins.length === 1 ? "" : "s"}</div>
          {t?.notes && <div className="muted small">{t.notes}</div>}
          <div className="btn-row"><button className="btn primary" onClick={() => onTrack(true)}>▶ {t?.end ? "Pick up the track" : "Back to tracking"}</button>
            <button className="btn" onClick={() => onTrack(false)}>🗺️ Map / edit</button></div>
        </>
      )}
      {x.result === "recovered" && <><div className="small">🦌 Recovered{n.recovery?.sex ? ` — ${n.recovery.sex}${n.recovery.points ? `, ${n.recovery.points} pts` : ""}` : ""}{x.found_yd ? ` · ${x.found_yd} yd from the hit` : ""} · {n.trips.length} trip{n.trips.length === 1 ? "" : "s"}</div>
        <button className="btn" onClick={() => onTrack(false)}>🗺️ Track map & log</button></>}
      {x.result === "not_found" && <><div className="small">✖ Not found{x.found_yd ? ` · blood to ${x.found_yd} yd` : ""} · {n.trips.length} trip{n.trips.length === 1 ? "" : "s"}</div>
        <button className="btn" onClick={() => onTrack(false)}>🗺️ Track map & log</button></>}
      {links}
    </div>
  );
}
