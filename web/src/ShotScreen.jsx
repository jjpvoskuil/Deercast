import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Icon from "./Icon.jsx";
import NumInput from "./NumInput.jsx";
import { GroundChip, ThemeButton } from "./Shell.jsx";
import { CARDINALS, degToCardinal, destination, YD } from "./lib/geo.js";
import { newId, nowIso } from "./lib/db.js";
import { defaultWeaponId, findWeapon, weaponIdFor, weaponOptions } from "./lib/gear.js";
import { atRange, DEER_FTLB } from "./lib/ballistics.js";
import { summary } from "./lib/archery.js";
import { BODY, DECOR, EVIDENCE, ORGANS, OUTCOMES, REACTION, VIEW, classify, depth, outline, project, standAngle, trace, viewBasis } from "./lib/shot.js";
import { COVER_BIAS, DOWNHILL_BIAS, REMOVED_NOTE, WATER_BIAS, applyWater, dryPieces, featureDistances, fetchBundledWater, fetchOsm, habitatMultiplier, lakesXY, mergeFeatures, searchGrid, waterMask, weightCells } from "./lib/recovery.js";
import { elevations, fetchForecast } from "./lib/weather.js";

const ANGLES = [[-90, "Facing you"], [-75, "Facing you (slight)"], [-60, "Hard quartering toward"], [-45, "Quartering toward"], [-30, "Slight quartering toward"],
  [-15, "Nearly broadside"], [0, "Broadside"], [15, "Nearly broadside"], [30, "Slight quartering away"], [45, "Quartering away"], [60, "Hard quartering away"],
  [75, "Facing away (slight)"], [90, "Facing away"]];
const WEAPONS = ["Bow", "Crossbow", "Rifle / shotgun slug", "Muzzleloader"];
const ARROW = ["(not checked yet)", "Pass-through — arrow recovered", "Pass-through — arrow not found", "Arrow stayed in deer / partial penetration", "Pulled out of deer — no pass-through", "Arrow not recovered — not sure if it passed through"];
const ARROW_NOTES = {
  "Pass-through — arrow not found": "Arrow passed through but wasn't found — search past where the deer stood, along the line of the shot (a light helps). Without the arrow, use hair and blood at the impact site to confirm the hit.",
  "Arrow stayed in deer / partial penetration": "No exit hole → expect much less blood, and often high on the body. The arrow may work out or break off in the first 50–150 yards — look for it on the trail.",
  "Pulled out of deer — no pass-through": "Partial penetration, no exit hole → expect less blood, and often high on the body. Check how far up the shaft the blood goes — that's how deep it went — and use the blood color on it for \"What did you find?\".",
  "Arrow not recovered — not sure if it passed through": "Look for the arrow and sign at the impact site before anything else; a pass-through gives a better blood trail than an arrow still in the deer.",
};
const DIRS = Object.fromEntries(CARDINALS.map((c, i) => [c, i * 22.5]));
const shade = (hex, f) => "#" + [1, 3, 5].map((i) => Math.round(Math.min(255, Math.max(0, parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("");
const pathOf = (pts, flip) => "M" + pts.map(([x, y]) => `${(flip * x).toFixed(2)},${(-y).toFixed(2)}`).join("L") + "Z";
const fmtWait = (w) => (w === 0 ? "Track now (carefully)" : w < 60 ? `${w} min` : `${Math.round(w / 60)}+ hours`);

const pad2 = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const RESULTS = [["tracking", "Still tracking"], ["recovered", "Recovered"], ["not_found", "Not found"]];
const DEFAULTS = { yawIdx: 6, side: "Left", buck: true, weapon: "Bow", dist: 20, height: 18, manual: false, manualPitch: 30, cross: null,
  evidence: "(not checked yet)", reaction: "(didn't see)", arrow: ARROW[0], useSign: true, boneChoice: null, toDeer: "N", ran: "Unknown", seen: 0 };

/** Hit analysis: where the shot went → what was hit, wait time, where to search. Opens over the hunt session for one
 *  shot (shotId) and saves its findings into that shot; without a shot it's just a calculator (More → Shot analyzer). */
export default function ShotScreen({ db, ground, data, demo, theme, onMenu, save, toast, active, shotId: openId, onClose, patchShot }) {
  // ------------------------------------------------ 0 the record: new or reopened, linked to a sit or not
  const pageRef = useRef(null);
  const [shotDate, setShotDate] = useState(() => localDay(new Date()));
  const [hitFix, setHitFix] = useState(null);     // exact hit site, if found / marked later
  // ------------------------------------------------ 1–2 deer position & shot
  const [yawIdx, setYawIdx] = useState(6);
  const yaw = ANGLES[yawIdx][0];
  const [side, setSide] = useState("Left");
  const [buck, setBuck] = useState(true);
  const [vitals, setVitals] = useState(true);
  const [weapon, setWeapon] = useState("Bow");   // category the hit model uses
  const [weaponId, setWeaponId] = useState(null); // which of your bows/guns (lib/gear.js)
  const [dist, setDist] = useState(20);
  const [height, setHeight] = useState(18);
  const [manual, setManual] = useState(false);
  const [manualPitch, setManualPitch] = useState(30);
  const pitch = manual ? manualPitch : Math.round(standAngle(height, dist));
  const mirror = side === "Right";
  const isBow = weapon === "Bow" || weapon === "Crossbow";
  const [gear, setGear] = useState(null);
  const gearRef = useRef(null); gearRef.current = gear;
  useEffect(() => { if (active) db.getDoc("gear", { setups: [], active: null }).then(setGear).catch(() => setGear(null)); }, [db, active]);
  const wOpts = weaponOptions(gear);
  const wSel = findWeapon(gear, weaponId) || findWeapon(gear, defaultWeaponId(gear));
  useEffect(() => { if (gear && !weaponId) { const id = defaultWeaponId(gear); setWeaponId(id); setWeapon(findWeapon(gear, id)?.weapon || "Bow"); } }, [gear]);
  const pickWeapon = (id) => { setWeaponId(id); setWeapon(findWeapon(gear, id)?.weapon || "Bow"); };
  // bow: the chosen setup, or your active bow for a generic "Bow"; gun: the chosen gun
  const setup = isBow ? (wSel?.kind === "bow" && wSel.setup) || gear?.setups.find((g) => g.id === gear.active) || null : null;
  const ss = setup ? summary(setup) : null;
  const gun = !isBow && wSel?.kind === "gun" ? wSel.setup : null;
  const gunAt = gun ? atRange(gun, dist) : null;

  // ------------------------------------------------ 3 crosshair
  const [cross, setCross] = useState(null); // model screen coords, pre-mirror
  const res = useMemo(() => (cross ? trace(cross[0], cross[1], yaw, pitch) : null), [cross, yaw, pitch]);

  // ------------------------------------------------ 4 analysis
  const [evidence, setEvidence] = useState("(not checked yet)");
  const [reaction, setReaction] = useState("(didn't see)");
  const [arrow, setArrow] = useState(ARROW[0]);
  const [useSign, setUseSign] = useState(true);
  const [boneChoice, setBoneChoice] = useState(null); // null = default
  const [primary, stopped, notes] = res ? classify(res, weapon) : ["miss", null, []];
  const sign = EVIDENCE[evidence];
  const partial = arrow.startsWith("Arrow stayed") || arrow.startsWith("Pulled out");
  const passed = arrow.startsWith("Pass-through");
  let planKey = primary;
  if (sign && sign !== primary && useSign) planKey = sign;
  const boneDefault = passed ? "yes" : partial || ss?.bone === "Low" ? "no" : "yes";
  if (stopped && (boneChoice ?? boneDefault) === "no" && !(sign && sign !== primary && useSign)) planKey = stopped;
  const O = OUTCOMES[planKey];
  let wait = O.wait_min;
  if (partial && O.lethal && wait >= 120) wait = Math.round(wait * 1.5);
  const restoring = useRef(false);
  useEffect(() => { if (restoring.current) { restoring.current = false; return; } setBoneChoice(null); }, [cross, yaw, pitch, arrow, weapon]);

  // ------------------------------------------------ 5 where to look
  const stands = data?.stands || [];
  const home = ground?.home || { lat: 37.3006, lon: -86.0608 };
  const [src, setSrc] = useState("Current location");
  // calculator only: start on the first stand. A saved shot keeps where it was taken from (incl. "Current location").
  useEffect(() => { if (!openId && stands.length && src === "Current location") setSrc(`Stand: ${stands[0].name}`); }, [stands.length]);
  const [fromAt, setFromAt] = useState(null); // where the phone was for a "Current location" shot
  const st = stands.find((s) => `Stand: ${s.name}` === src);
  const from = st ? [st.lat, st.lon] : fromAt || [home.lat, home.lon];
  const [toDeer, setToDeer] = useState("N");
  const [ran, setRan] = useState("Unknown");
  const [seen, setSeen] = useState(0);
  const hitEst = destination(from[0], from[1], DIRS[toDeer], dist * YD);
  const hit = hitFix ? [hitFix.lat, hitFix.lon] : hitEst;
  const runDir = ran === "Unknown" ? null : DIRS[ran];
  const [lo, med, hi] = O.yards;
  const yards = [Math.max(lo, seen), Math.max(med, Math.round(seen * 1.4)), Math.max(hi, Math.round(seen * 2.2))];
  const marks = (data?.features || []).filter((f) => ["water", "cover", "bedding"].includes(f.type));

  // ------------------------------------------------ 6 timing
  const [shotTime, setShotTime] = useState(() => localHM(new Date()));
  const [note, setNote] = useState("");

  const flip = mirror ? -1 : 1;
  const svgRef = useRef(null);
  const onTap = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const sx = VIEW.xMin + ((e.clientX - r.left) / r.width) * (VIEW.xMax - VIEW.xMin);
    const sy = VIEW.yMax - ((e.clientY - r.top) / r.height) * (VIEW.yMax - VIEW.yMin);
    setCross([mirror ? -sx : sx, sy]);
  };
  const nudge = (dx, dy) => setCross(([x, y]) => [x + (mirror ? -dx : dx), y + dy]);

  // ------------------------------------------------ load / reset / save (each stage can be saved and reopened later)
  const apply = (i, rec) => {
    const v = { ...DEFAULTS, ...Object.fromEntries(Object.entries(i || {}).filter(([, x]) => x != null)) };
    restoring.current = true;
    setYawIdx(v.yawIdx); setSide(v.side); setBuck(v.buck); setWeapon(v.weapon); setWeaponId(v.weaponId || weaponIdFor(gearRef.current, rec || { weapon: v.weapon })); setDist(v.dist); setHeight(v.height);
    setManual(v.manual); setManualPitch(v.manualPitch); setCross(v.cross); setEvidence(v.evidence); setReaction(v.reaction); setArrow(v.arrow);
    setUseSign(v.useSign); setBoneChoice(v.boneChoice); setToDeer(v.toDeer); setRan(v.ran); setSeen(v.seen);
    if (v.src) setSrc(v.src);
    setFromAt(rec?.from_lat != null ? [rec.from_lat, rec.from_lon] : null);
    const hp = (rec?.pins || []).find((p) => p.kind === "hit"); // the hit site pinned while tracking beats the estimate
    setHitFix(hp ? { lat: hp.lat, lon: hp.lon } : rec?.hit_fix || null);
  };
  const startNew = ({ huntId: hid = null, stand = null, time = Date.now() } = {}) => {
    apply({ src: stand && stands.some((x) => `Stand: ${x.name}` === stand) ? stand : undefined }, null);
    const d = new Date(time); setShotDate(localDay(d)); setShotTime(localHM(d));
    setTimeout(() => pageRef.current?.scrollTo(0, 0), 0);
  };
  const openRec = (rec) => {
    apply(rec.input ? { ...rec.input, weaponId: rec.input.weaponId || rec.weapon_id } : { src: rec.stand, weapon: rec.weapon, weaponId: rec.weapon_id, dist: rec.distance_yd, ran: rec.ran, evidence: rec.evidence, reaction: rec.reaction, arrow: rec.arrow }, rec);
    const [d, t] = String(rec.time || "").split(" ");
    if (d && t) { setShotDate(d); setShotTime(t.slice(0, 5)); }
    setTimeout(() => pageRef.current?.scrollTo(0, 0), 0);
  };
  useEffect(() => {
    if (!openId) { startNew(); return; }
    db.listShots().then((all) => { const r = all.find((x) => x.id === openId); if (r) openRec(r); }).catch(() => {});
  }, [openId]);

  const saveShot = async () => {
    const patch = {
      stand: src, weapon, weapon_id: wSel?.id || null, weapon_kind: wSel?.kind || null, angle: ANGLES[yawIdx][1], side, pitch_deg: pitch, distance_yd: dist, outcome: res ? O.title : "Hit — spot not marked",
      organs: (res?.hits || []).map((x) => x.label), evidence, arrow, setup: (isBow ? setup : gun)?.name || null, gun_ftlb: gunAt ? Math.round(gunAt.ftlb) : null, reaction, ran, seen_yd: seen, wait_min: res ? wait : null,
      hit_lat: Math.round(hitEst[0] * 1e6) / 1e6, hit_lon: Math.round(hitEst[1] * 1e6) / 1e6, analysis_at: nowIso(),
      input: { yawIdx, side, buck, weapon, weaponId: wSel?.id || null, dist, height, manual, manualPitch, cross, evidence, reaction, arrow, useSign, boneChoice, src, toDeer, ran, seen },
    };
    if (await patchShot(openId, patch, res ? `Saved — wait ${fmtWait(wait)} before tracking` : "Saved")) onClose?.();
  };
  const isHit = true;

  return (
    <div className="page" ref={pageRef} style={{ display: active ? undefined : "none" }}>
      <header className="page-top">
        <GroundChip ground={ground} onClick={onMenu} demo={demo} />
        <span className="spacer" />
        <ThemeButton theme={theme} />
      </header>
      <div className="page-title"><span className="label">Estimates are general guidance — every deer is different</span><h1>Hit analysis</h1></div>
      {onClose && <button className="btn sm overlay-close" onClick={onClose}><Icon name="x" size={18} /> {openId ? "Back to the hunt" : "Close"}</button>}
      {!openId && <p className="muted small">Calculator only — to save a shot, use 🎯 I took a shot in the Hunt Log.</p>}

      <>
      <section className="card">
        <span className="h2">1 · How was the deer standing?</span>
        <label className="field"><span>Deer's angle to you: <b>{ANGLES[yawIdx][1]}</b></span>
          <input type="range" min="0" max={ANGLES.length - 1} value={yawIdx} onChange={(e) => setYawIdx(+e.target.value)} className="range" /></label>
        <div className="seg">{["Left", "Right"].map((s) => <button key={s} className={side === s ? "on" : ""} onClick={() => setSide(s)}>{s} side toward you</button>)}</div>
        <div className="toggles">
          <label className="toggle"><input type="checkbox" checked={buck} onChange={(e) => setBuck(e.target.checked)} /><span className="track"><span className="knob" /></span><span>Buck</span></label>
          <label className="toggle"><input type="checkbox" checked={vitals} onChange={(e) => setVitals(e.target.checked)} /><span className="track"><span className="knob" /></span><span>Show vitals</span></label>
        </div>
      </section>

      <section className="card">
        <span className="h2">2 · Your shot</span>
        <div className="grid2">
          <label className="field half"><span>Weapon</span><select value={wSel?.id || ""} onChange={(e) => pickWeapon(e.target.value)}>{wOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
          <label className="field half"><span>Distance (yd)</span><NumInput min={1} max={400} value={dist} onChange={setDist} /></label>
          <label className="field half"><span>Stand height (ft, 0 = ground)</span><NumInput min={0} max={40} value={height} onChange={setHeight} /></label>
          <div className="field half"><span>Downward angle</span><span className="big" style={{ fontSize: 26 }}>{pitch}°</span></div>
        </div>
        <label className="check"><input type="checkbox" checked={manual} onChange={(e) => { setManual(e.target.checked); setManualPitch(pitch); }} /> Set angle manually</label>
        {manual && <input type="range" className="range" min="0" max="70" value={manualPitch} onChange={(e) => setManualPitch(+e.target.value)} />}
        {isBow && (ss ? <p className="muted small"><b>{setup.name}</b> — {Math.round(ss.fps)} fps, {Math.round(ss.ke)} ft·lb, momentum {ss.momentum.toFixed(2)}, {setup.tip_type?.toLowerCase()} · bone penetration <b>{ss.bone}</b></p>
          : <p className="muted small">Add your bow under More → Bow setup to factor penetration into the estimate.</p>)}
        {!isBow && (gunAt ? <p className={`small ${gunAt.ftlb < DEER_FTLB ? "warn-text" : "muted"}`}><b>{gun.name}</b> at {dist} yd: {Math.round(gunAt.fps)} fps, <b>{Math.round(gunAt.ftlb)} ft·lb</b>, {gunAt.dropIn >= 0 ? "+" : ""}{gunAt.dropIn.toFixed(1)} in vs. your {gun.zero_yd || 100} yd zero
            {gunAt.ftlb < DEER_FTLB ? ` — under the ~${DEER_FTLB} ft·lb guideline for deer; expect less expansion and a longer track.` : "."}</p>
          : <p className="muted small">Add your gun under More → Gun setup to see energy and drop at this distance.</p>)}
      </section>

      {isHit && <section className="card">
        <span className="h2">3 · Tap where you hit</span>
        <p className="muted small">Set the angle first, then tap the deer where the arrow/bullet went in.</p>
        <DeerView refEl={svgRef} yaw={yaw} pitch={pitch} flip={flip} buck={buck} vitals={vitals} cross={cross} hitKeys={new Set((res?.hits || []).map((h) => h.key))} onTap={onTap} />
        {cross ? (
          <div className="nudge">
            <button className="btn sm" aria-label="Left" onClick={() => nudge(-1, 0)}>◀</button>
            <button className="btn sm" aria-label="Up" onClick={() => nudge(0, 1)}>▲</button>
            <button className="btn sm" aria-label="Down" onClick={() => nudge(0, -1)}>▼</button>
            <button className="btn sm" aria-label="Right" onClick={() => nudge(1, 0)}>▶</button>
            <button className="btn sm" aria-label="Clear" onClick={() => setCross(null)}><Icon name="x" size={18} /></button>
          </div>
        ) : <p className="muted">Tap the deer to place the crosshair.</p>}
      </section>}

      {isHit && res && (
        <section className="card">
          <span className="h2">4 · What was likely hit</span>
          <label className="field"><span>What did you find? (arrow / impact site)</span><select value={evidence} onChange={(e) => setEvidence(e.target.value)}>{Object.keys(EVIDENCE).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="field"><span>Deer's reaction</span><select value={reaction} onChange={(e) => setReaction(e.target.value)}>{Object.keys(REACTION).map((k) => <option key={k}>{k}</option>)}</select></label>
          {isBow && <label className="field"><span>Arrow</span><select value={arrow} onChange={(e) => setArrow(e.target.value)}>{ARROW.map((k) => <option key={k}>{k}</option>)}</select></label>}
          {sign && sign !== primary && (
            <div className="confirm">Your sign points to <b>{OUTCOMES[sign].title}</b>, but the shot placement suggests <b>{OUTCOMES[primary].title}</b>. Physical sign is more reliable than an estimated hit spot.
              <div className="seg" style={{ marginTop: 8 }}><button className={useSign ? "on" : ""} onClick={() => setUseSign(true)}>Plan for sign</button><button className={!useSign ? "on" : ""} onClick={() => setUseSign(false)}>Plan for placement</button></div></div>
          )}
          {stopped && !(sign && sign !== primary && useSign) && (
            <div className="confirm">Did the arrow penetrate past the shoulder bone?{ss?.bone ? ` Your setup's bone-penetration rating: ${ss.bone}.` : ""}
              <div className="seg" style={{ marginTop: 8 }}>
                <button className={(boneChoice ?? boneDefault) === "yes" ? "on" : ""} onClick={() => setBoneChoice("yes")}>Yes / not sure</button>
                <button className={(boneChoice ?? boneDefault) === "no" ? "on" : ""} onClick={() => setBoneChoice("no")}>Stopped at bone</button></div>
              <div className="muted small">Yes → {OUTCOMES[primary].title} · Stopped → {OUTCOMES[stopped].title}</div></div>
          )}
          {REACTION[reaction] && <p className="muted small">Reaction: {REACTION[reaction]}</p>}

          <div className={`outcome ${O.lethal ? "" : "warn"}`}>
            <div className="h2">{O.title}</div>
            <div className="stats">
              <div><span className="big">{O.time}</span><span className="label">Survival time</span></div>
              <div><span className="big">{fmtWait(wait)}</span><span className="label">Wait before tracking</span></div>
              <div><span className="big">{hi ? `${med} yd` : "—"}</span><span className="label">{hi ? `Likely distance (${lo}–${hi})` : "Likely distance"}</span></div>
            </div>
            {!O.lethal && <p className="err"><b>This hit is often not fatal.</b> Track carefully, but be prepared that the deer may recover.</p>}
          </div>
          {res.hits.length > 0 && (
            <div className="hours-grid three"><span className="muted">Organ / tissue</span><span className="muted">Path (in)</span><span className="muted">Note</span>
              {res.hits.map((h) => <Row3 key={h.key} a={h.label} b={h.length.toFixed(1)} c={h.afterBone && stopped ? "past bone — only if it penetrated" : ""} />)}</div>
          )}
          {notes.map((n) => <p key={n} className="muted small">• {n}</p>)}
          {!res.missed && <>
            {isBow && !partial && <p className="muted small">• {res.exit[2] < -3 ? "Exit is low on the body — usually a better blood trail." : "Exit is high on the body — blood may be slow to hit the ground at first."}</p>}
            <p><b>Blood sign to expect:</b> {O.blood}</p>
          </>}
          {ARROW_NOTES[arrow] && <p className="confirm small">{ARROW_NOTES[arrow]}{partial && O.lethal && O.wait_min >= 120 ? " Wait time increased by half for this hit." : ""}</p>}
          {!res.missed && <details className="more-box"><summary>Arrow path diagram</summary><PathDiagram res={res} mirror={mirror} /></details>}
        </section>
      )}

      {isHit && res && planKey !== "miss" && (
        <>
          <section className="card">
            <span className="h2">5 · Where to look</span>
            <label className="field"><span>You shot from</span>
              <select value={src} onChange={(e) => setSrc(e.target.value)}>{["Current location", ...stands.map((s) => `Stand: ${s.name}`)].map((o) => <option key={o} value={o}>{o.replace("Stand: ", "")}</option>)}</select></label>
            <div className="grid2">
              <label className="field half"><span>Direction from you to the deer</span><select value={toDeer} onChange={(e) => setToDeer(e.target.value)}>{CARDINALS.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="field half"><span>Direction the deer ran</span><select value={ran} onChange={(e) => setRan(e.target.value)}>{["Unknown", ...CARDINALS].map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
            <label className="field"><span>Last saw it this far from where it was hit (yd, 0 = not seen)</span><NumInput min={0} max={1000} value={seen} onChange={setSeen} /></label>
            <RecoveryMap from={from} hit={hit} yards={yards} runDir={runDir} planKey={planKey} marks={marks} active={active} />
          </section>

          <section className="card">
            <span className="h2">6 · When to go</span>
            <div className="grid2">
              <label className="field half"><span>Time of shot</span><input type="time" step="300" value={shotTime} onChange={(e) => setShotTime(e.target.value)} /></label>
              <div className="field half"><span>Start tracking at</span><span className="big" style={{ fontSize: 24 }}>{(() => {
                const [h, m] = shotTime.split(":").map(Number); const t = new Date(); t.setHours(h, m + wait, 0, 0);
                const next = t.getDate() !== new Date().getDate();
                return `${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${next ? " (next day)" : ""}`;
              })()}</span></div>
            </div>
            <WeatherAlerts hit={hit} wait={wait} active={active} />
          </section>

          <section className="card">
            <span className="h2">7 · Tracking tips</span>
            <ul>{O.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            <details className="more-box"><summary>General tracking checklist</summary><ul>
              <li>Before you climb down, note the exact spot the deer stood when hit and the last place you saw it (landmark + compass bearing). Drop a pin.</li>
              <li>Find the arrow: blood color, bubbles, hair, gut matter and smell tell you more than the hit spot.</li>
              <li>Hair at the impact site: long dark hair = back; white hair = belly/brisket; brown hair = side.</li>
              <li>Mark the last good blood with flagging tape; if the trail stops, search in widening circles or a grid.</li>
              <li>Track slowly and quietly, one person on the blood, others looking ahead.</li>
              <li>Check thick cover, creek bottoms and downhill benches — wounded deer often head there.</li>
              <li>If you jump a deer that isn't expiring, stop, mark the spot and back out — come back later.</li>
              <li>Use a bright white or green light at night; blood shows up better.</li>
              <li>Tracking dogs may be legal in your state — check regulations and know a handler before you need one.</li>
            </ul></details>
          </section>
        </>
      )}

      </>
      {openId && <section className="card">
        <button className="btn primary wide" onClick={saveShot}>Save analysis to this shot</button>
        <p className="muted small">Saves the hit estimate, wait time and search map inputs. Tracking itself is logged on the tracking map.</p>
      </section>}
      {onClose && <button className="btn wide page-end" onClick={onClose}><Icon name="x" size={18} /> {openId ? "Back to the hunt" : "Close"}</button>}
    </div>
  );
}
const Row3 = ({ a, b, c }) => <><span>{a}</span><span>{b}</span><span className="muted small">{c}</span></>;

/** Shooter's-eye view drawn as vector shapes from the anatomy model (replaces the matplotlib image). */
function DeerView({ refEl, yaw, pitch, flip, buck, vitals, cross, hitKeys, onTap }) {
  const [d, r, u] = viewBasis(yaw, pitch);
  const body = [...BODY, ...DECOR].sort((a, b) => depth(b, d) - depth(a, d));
  const organs = [...ORGANS].sort((a, b) => depth(b, d) - depth(a, d));
  const belly = { center: [2, 0, -6.5], semi: [15, 6.5, 3.5] };
  const antlers = [];
  if (buck) for (const s of [1, -1]) {
    const beam = [[31, 1.5 * s, 21], [29, 5 * s, 26], [31, 7 * s, 29], [36, 6.5 * s, 31], [40, 4.5 * s, 30.5]];
    const tines = [[[30.5, 6 * s, 28], [31, 6.5 * s, 33]], [[34, 7 * s, 30.5], [34.5, 7.5 * s, 35]], [[37.5, 5.8 * s, 31], [38.5, 6 * s, 34.5]]];
    for (const line of [beam, ...tines]) antlers.push(line.map((p) => project(p, r, u)));
  }
  const pl = (pts) => pts.map(([x, y]) => `${(flip * x).toFixed(2)},${(-y).toFixed(2)}`).join(" ");
  return (
    <svg ref={refEl} className="deer-view" viewBox={`${VIEW.xMin} ${-VIEW.yMax} ${VIEW.xMax - VIEW.xMin} ${VIEW.yMax - VIEW.yMin}`}
      onClick={onTap} role="img" aria-label="Deer seen from your position — tap where you hit">
      <rect x={VIEW.xMin} y={-VIEW.yMax} width={VIEW.xMax - VIEW.xMin} height={VIEW.yMax - VIEW.yMin} fill="#33402f" />
      <ellipse cx="0" cy="36.5" rx="35" ry="3" fill="#000" opacity="0.25" />
      {body.map((p) => <path key={p.key} d={pathOf(outline(p, r, u), flip)} fill={depth(p, d) > 2 ? shade(p.color, 0.78) : p.color} />)}
      {antlers.map((pts, i) => <polyline key={i} points={pl(pts)} fill="none" stroke="#e6d8b8" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />)}
      <path d={pathOf(outline(belly, r, u), flip)} fill="#c9ad84" opacity="0.35" />
      {vitals && organs.map((p) => {
        const on = hitKeys.has(p.key);
        return <path key={p.key} d={pathOf(outline(p, r, u), flip)} fill={p.color} opacity={on ? 0.75 : 0.38} stroke={on ? "#fff" : "none"} strokeWidth="0.35" />;
      })}
      {cross && (() => {
        const cx = flip * cross[0], cy = -cross[1];
        return <g stroke="#ff3b30" strokeWidth="0.65" strokeLinecap="round" fill="none">
          <circle cx={cx} cy={cy} r="3.2" />
          {[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => <line key={`${a}${b}`} x1={cx + a * 1.2} y1={cy + b * 1.2} x2={cx + a * 6} y2={cy + b * 6} />)}
          <circle cx={cx} cy={cy} r="0.5" fill="#ff3b30" />
        </g>;
      })()}
    </svg>
  );
}

/** Top and side views of the arrow path through the body. */
function PathDiagram({ res, mirror }) {
  const ys = mirror ? -1 : 1;
  const hit = new Set(res.hits.map((h) => h.key));
  const view = (i, j, title, yMin, yMax) => {
    const sy = (v) => -(j === 1 ? v * ys : v);
    const e = res.entry, x = res.exit;
    const len = Math.hypot(x[0] - e[0], x[1] - e[1], x[2] - e[2]) || 1;
    const src = e.map((v, k) => v - (9 * (x[k] - e[k])) / len);
    return (
      <figure className="diagram">
        <figcaption className="muted small">{title}</figcaption>
        <svg viewBox={`-30 ${-yMax} 76 ${yMax - yMin}`} role="img" aria-label={title}>
          <rect x="-30" y={-yMax} width="76" height={yMax - yMin} fill="#33402f" />
          {BODY.filter((p) => !(j === 1 && p.key.startsWith("leg"))).map((p) => <ellipse key={p.key} cx={p.center[i]} cy={sy(p.center[j])} rx={p.semi[i]} ry={p.semi[j]} fill={p.color} opacity="0.55" />)}
          {ORGANS.map((p) => <ellipse key={p.key} cx={p.center[i]} cy={sy(p.center[j])} rx={p.semi[i]} ry={p.semi[j]} fill={p.color} opacity={hit.has(p.key) ? 0.95 : 0.3} stroke={hit.has(p.key) ? "#fff" : "none"} strokeWidth="0.4" />)}
          <line x1={src[i]} y1={sy(src[j])} x2={e[i]} y2={sy(e[j])} stroke="#ffd60a" strokeWidth="0.4" strokeDasharray="1 1" />
          <line x1={e[i]} y1={sy(e[j])} x2={x[i]} y2={sy(x[j])} stroke="#ff8c1a" strokeWidth="1" markerEnd="url(#ah)" />
          <circle cx={e[i]} cy={sy(e[j])} r="1.2" fill="#ff3b30" />
          <defs><marker id="ah" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="#ff8c1a" /></marker></defs>
        </svg>
      </figure>
    );
  };
  return <>{view(0, 1, "Top view (head →) · yellow dots = from you", -15, 15)}{view(0, 2, "Side view (head →)", -37, 26)}</>;
}

/** Probability search map around the hit site (Leaflet). */
function RecoveryMap({ from, hit, yards, runDir, planKey, marks, active, trail = [] }) {
  const el = useRef(null), map = useRef(null), layer = useRef(null);
  const [info, setInfo] = useState({ elev: false, habitat: false });
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: "Esri, Maxar" }).addTo(m);
    m.attributionControl.setPrefix(false);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => m.remove();
  }, []);
  useEffect(() => { if (active && map.current) setTimeout(() => map.current.invalidateSize(), 0); }, [active]);
  const key = JSON.stringify([from, hit, yards, runDir, planKey, marks.length, trail.map((t) => [t.lat, t.lon])]);
  useEffect(() => {
    let stale = false;
    (async () => {
      const cells = searchGrid(hit[0], hit[1], yards, runDir);
      const bias = DOWNHILL_BIAS[planKey] || 0;
      let elev = null;
      if (bias > 0) { try { elev = await elevations([hit, ...cells.map((c) => c.center)]); } catch { elev = null; } }
      let w = weightCells(cells, yards, runDir, elev ? elev.slice(1) : null, elev ? elev[0] : null, bias);
      const [ovp, bundled] = await Promise.all([fetchOsm(+hit[0].toFixed(4), +hit[1].toFixed(4), yards[2] * YD * 1.2), fetchBundledWater(hit[0], hit[1])]);
      const osm = mergeFeatures(ovp, bundled);
      const habitat = !!((osm && (osm.water.length || osm.cover.length)) || marks.length);
      if (habitat) {
        const hm = habitatMultiplier(featureDistances(cells, hit[0], hit[1], osm, marks), WATER_BIAS[planKey] ?? 0.5, COVER_BIAS[planKey] ?? 0.7);
        w = w.map((x, i) => x * hm[i]); const s = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / s);
      }
      // open water: never a probable spot, and the deer didn't swim across — its share goes to the shore
      const lakes = lakesXY(hit[0], hit[1], osm);
      const water = applyWater(w, cells, waterMask(cells, hit[0], hit[1], osm));
      w = water.w;
      const big = Math.max(0, ...lakes.map((l) => l.area)) >= 80000; // ~20 acres
      if (stale || !layer.current) return;
      const lg = layer.current; lg.clearLayers();
      const wmax = Math.max(...w);
      cells.forEach((c, i) => {
        const a = wmax > 0 ? w[i] / wmax : 0;
        if (a < 0.08) return;
        const tip = `${Math.round(c.dist_yd)} yd ${degToCardinal(c.bearing)} · relative chance ${Math.round(a * 100)}%`;
        for (const poly of dryPieces(c, hit, lakes)) L.polygon(poly, { stroke: false, fillColor: "#ff3b30", fillOpacity: 0.08 + 0.45 * a }).bindPopup(tip).addTo(lg);
      });
      L.circle(hit, { radius: yards[1] * YD, color: "#ffd60a", weight: 1.5, fill: false, dashArray: "6" }).bindPopup(`Typical distance ~${yards[1]} yd`).addTo(lg);
      for (const g of osm?.water || []) L.polyline(g, { color: "#3a86ff", weight: 3, opacity: 0.8, interactive: false }).addTo(lg);
      for (const g of osm?.cover || []) L.polyline(g, { color: "#52b788", weight: 2, opacity: 0.7, dashArray: "4", interactive: false }).addTo(lg);
      for (const f of marks) L.circle([f.lat, f.lon], { radius: (f.radius_yd || 40) * YD, color: { water: "#3a86ff", cover: "#2d6a4f", bedding: "#ffb703" }[f.type], weight: 2, fillOpacity: 0.2 }).bindPopup(`Your mark: ${f.type} ${f.name || ""}`).addTo(lg);
      L.circleMarker(from, { radius: 8, color: "#fff", weight: 2, fillColor: "#1e7bff", fillOpacity: 1 }).bindPopup("You").addTo(lg);
      L.circleMarker(hit, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff3b30", fillOpacity: 1 }).bindPopup("Hit site — start here").addTo(lg);
      if (runDir != null) L.polyline([hit, destination(hit[0], hit[1], runDir, 40)], { color: "#ff8c1a", weight: 4 }).addTo(lg);
      if (trail.length) {
        L.polyline([hit, ...trail.map((t) => [t.lat, t.lon])], { color: "#ffd60a", weight: 3, dashArray: "2 6" }).addTo(lg);
        trail.forEach((t, i) => L.marker([t.lat, t.lon], { icon: L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="emoji">🩸</div>' }) })
          .bindPopup(`Trip ${i + 1}: left off here (${t.date} ${t.to || ""})`).addTo(lg));
      }
      [...w.keys()].filter((k) => w[k] > 0).sort((a, b) => w[b] - w[a]).slice(0, 3).forEach((k, n) => {
        L.marker(cells[k].center, { icon: L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="rank-pin">${n + 1}</div>` }) })
          .bindPopup(`#${n + 1} most likely area · ${Math.round(cells[k].dist_yd)} yd ${degToCardinal(cells[k].bearing)}`).addTo(lg);
      });
      map.current.fitBounds(L.latLngBounds([from, hit, ...trail.map((t) => [t.lat, t.lon]), ...cells.filter((c, i) => wmax > 0 && w[i] / wmax >= 0.08).map((c) => c.center)]).pad(0.1), { maxZoom: 18 });
      setInfo({ elev: !!elev, habitat, marks: marks.length > 0, lakes: lakes.length > 0, removed: water.removed, big, allWet: !(wmax > 0) });
    })();
    return () => { stale = true; };
  }, [key]);
  return (
    <>
      <div ref={el} className="rec-map" />
      <p className="muted small">Red shading = relative chance the deer is there, from typical travel distance for this hit{runDir != null ? ", the direction it ran" : ""}{info.elev ? ", terrain (downhill)" : ""}{info.habitat ? `, and nearby water & heavy cover (blue = water, green dashes = woods${info.marks ? ", circles = your marks" : ""})` : ""}.{info.lakes ? " Open water is never shaded — a hit deer goes down on land, and isn't assumed to swim across." : ""} Numbers 1–3 = best places to search first.</p>
      {info.allWet && <p className="confirm small">The hit site is out in the water on the map — check the shot distance and direction.</p>}
      {!info.allWet && info.removed >= REMOVED_NOTE && <p className="confirm small">{info.big ? "Spots over the lake were removed — the deer most likely went down along the shore." : "Spots over the pond were removed — the deer most likely went down along the bank."}</p>}
      {!info.habitat && <p className="muted small">No water/cover data found here. Mark creeks, ponds, thickets and bedding areas on the Map (tap → Add mark) and they'll be weighted in.</p>}
    </>
  );
}

function WeatherAlerts({ hit, wait, active }) {
  const [msgs, setMsgs] = useState([]);
  useEffect(() => {
    if (!active) return;
    fetchForecast(hit[0], hit[1]).then(({ rows }) => {
      const now = Date.now(), end = now + (wait + 240) * 60000;
      const nxt = rows.filter((r) => r.time >= Math.floor(now / 3600e3) * 3600e3 && r.time <= end);
      const out = [];
      const rain = nxt.find((r) => r.precip_in >= 0.02);
      if (rain) out.push(`Rain expected around ${new Date(rain.time).toLocaleTimeString([], { hour: "numeric" })} — it can wash out the blood trail. Mark every drop of blood now (flagging tape / phone pins). For quick-kill hits it can be worth starting a little earlier; for gut or liver hits, waiting still matters more than the blood.`);
      const hot = Math.max(...nxt.map((r) => r.temp_f));
      if (wait >= 240 && hot >= 50) out.push(`Temperatures up to ${Math.round(hot)}°F during the wait — meat can spoil on a long wait. Recover and field-dress as soon as the wait allows.`);
      setMsgs(out);
    }).catch(() => setMsgs([]));
  }, [hit[0].toFixed(4), hit[1].toFixed(4), wait, active]);
  return msgs.map((m) => <p key={m} className="confirm small">{m}</p>);
}

