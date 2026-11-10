// Map editing (same features as the Streamlit map): add a stand or a mark where you tapped, "Forecast this pin",
// bait & food list with "Filled today", water/cover/bedding marks, and stand edit / center / delete.
import { useState } from "react";
import Icon from "./Icon.jsx";
import NumInput from "./NumInput.jsx";
import { CARDINALS_8, windOkForStand } from "./lib/geo.js";
import { newId } from "./lib/db.js";
import { dateKey, daysBetween } from "./lib/model/tz.js";

export const FEATURE_TYPES = {
  water: "Water", cover: "Thick cover", bedding: "Bedding area",
  feeder: "Broadcast corn feeder", corn_shelled: "Shelled corn pile", corn_ear: "Ear corn pile", food_other: "Other food / plot",
  camera: "Trail camera",
};
export const BAIT = new Set(["feeder", "corn_shelled", "corn_ear", "food_other"]);
const STAND_TYPES = ["Ladder", "Hang-on", "Climber", "Ground blind", "Box blind", "Saddle", "Other"];
const TZ = "America/Chicago";
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function WindChips({ value, onChange }) {
  return (
    <div className="filter-row">
      {CARDINALS_8.map((c) => <button key={c} className={`fchip ${value.includes(c) ? "on" : ""}`}
        onClick={() => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])}>{c}</button>)}
    </div>
  );
}

export function TapActions({ tapped, ground, save, onForecast, onClear, stands = [] }) {
  const [mode, setMode] = useState(null);
  const [st, setSt] = useState({ name: "", type: "Ladder", good_winds: [], notes: "" });
  const [ft, setFt] = useState({ type: "feeder", name: "", radius_yd: 40, last_filled: dateKey(Date.now(), TZ) });
  const saveStand = async () => {
    if (!st.name.trim()) return;
    const rec = { id: newId(), name: st.name.trim(), lat: r6(tapped[0]), lon: r6(tapped[1]), type: st.type, good_winds: st.good_winds, notes: st.notes, created: stamp() };
    if (await save((d) => d.saveStand(ground.id, rec), { ok: `Saved ${rec.name}` })) { onClear(); setMode(null); }
  };
  const saveFeature = async () => {
    const bait = BAIT.has(ft.type);
    const rec = { id: newId(), type: ft.type, name: ft.name.trim(), lat: r6(tapped[0]), lon: r6(tapped[1]), radius_yd: bait || ft.type === "camera" ? 10 : +ft.radius_yd || 40, created: stamp() };
    if (bait) rec.last_filled = ft.last_filled || dateKey(Date.now(), TZ);
    if (ft.type === "camera") rec.stand_id = ft.stand_id || null;
    if (await save((d) => d.saveFeature(ground.id, rec), { ok: `Saved ${FEATURE_TYPES[ft.type]}` })) { onClear(); setMode(null); }
  };
  return (
    <>
      <div className="btn-row">
        <button className="btn sm" onClick={onForecast}>Forecast this pin</button>
        <button className="btn sm" onClick={() => setMode(mode === "stand" ? null : "stand")}>Add stand</button>
        <button className="btn sm" onClick={() => setMode(mode === "mark" ? null : "mark")}>Add mark</button>
      </div>
      {mode === "stand" && (
        <div className="form">
          <label className="field"><span>Stand name</span><input value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} /></label>
          <label className="field"><span>Type</span><select value={st.type} onChange={(e) => setSt({ ...st, type: e.target.value })}>{STAND_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <div className="field"><span>Good wind directions (wind blowing from)</span><WindChips value={st.good_winds} onChange={(v) => setSt({ ...st, good_winds: v })} /></div>
          <label className="field"><span>Notes</span><textarea rows="2" value={st.notes} onChange={(e) => setSt({ ...st, notes: e.target.value })} /></label>
          <button className="btn primary wide" disabled={!st.name.trim()} onClick={saveStand}>Save stand</button>
        </div>
      )}
      {mode === "mark" && (
        <div className="form">
          <label className="field"><span>Type</span><select value={ft.type} onChange={(e) => setFt({ ...ft, type: e.target.value })}>
            {Object.entries(FEATURE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Name (optional)</span><input placeholder="e.g. back feeder, creek bottom" value={ft.name} onChange={(e) => setFt({ ...ft, name: e.target.value })} /></label>
          {BAIT.has(ft.type)
            ? <label className="field"><span>Last filled</span><input type="date" value={ft.last_filled} onChange={(e) => setFt({ ...ft, last_filled: e.target.value })} /></label>
            : ft.type === "camera" ? <CamStand stands={stands} value={ft.stand_id} onChange={(v) => setFt({ ...ft, stand_id: v })} /> : <label className="field"><span>Radius (yd)</span><NumInput min={10} max={300} value={ft.radius_yd} onChange={(v) => setFt({ ...ft, radius_yd: v })} /></label>}
          <p className="muted small">Water, cover and bedding marks feed the Shot & Recovery search map — wounded deer head for water and heavy cover.</p>
          <button className="btn primary wide" onClick={saveFeature}>Save mark</button>
        </div>
      )}
    </>
  );
}

/** A trail camera next to a stand counts its deer toward that stand's history (Best stand). */
function CamStand({ stands, value, onChange }) {
  return (
    <label className="field"><span>Next to a stand? (its deer then count for that stand)</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">No — just in the area</option>{stands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
  );
}

export function SiteLists({ features, stands, wind, ground, save, onCenter }) {
  const today = dateKey(Date.now(), TZ);
  const bait = features.filter((f) => BAIT.has(f.type)), cams = features.filter((f) => f.type === "camera");
  const other = features.filter((f) => !BAIT.has(f.type) && f.type !== "camera");
  const [edit, setEdit] = useState(null);
  const [confirm, setConfirm] = useState(null);
  return (
    <>
      <div className="card">
        <span className="sub-h">Stands ({stands.length})</span>
        {!stands.length && <p className="muted small">Tap the map where a stand is, then Add stand.</p>}
        {stands.map((s) => {
          const ok = wind ? windOkForStand(wind.dir, s.good_winds) : null;
          if (edit?.id === s.id) return (
            <div key={s.id} className="form punch-edit">
              <label className="field"><span>Name</span><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <div className="field"><span>Good wind directions</span><WindChips value={edit.good_winds || []} onChange={(v) => setEdit({ ...edit, good_winds: v })} /></div>
              <label className="field"><span>Notes</span><textarea rows="2" value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
              <div className="btn-row">
                <button className="btn primary" onClick={async () => { if (await save((d) => d.saveStand(ground.id, edit), { ok: "Stand saved" })) setEdit(null); }}>Save</button>
                <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
                <button className="btn" onClick={() => setConfirm(s.id)}>Delete</button>
              </div>
              {confirm === s.id && <div className="confirm">Delete {s.name} for everyone on this ground?
                <div className="btn-row"><button className="btn danger" onClick={async () => { if (await save((d) => d.deleteStand(ground.id, s.id), { ok: "Stand deleted" })) { setEdit(null); setConfirm(null); } }}>Delete</button>
                  <button className="btn" onClick={() => setConfirm(null)}>Keep</button></div></div>}
            </div>
          );
          return (
            <div key={s.id} className="stand-row">
              <span className={`status ${ok === null ? "none" : ok ? "good" : "bad"}`}><Icon name={ok === null ? "minus" : ok ? "check" : "x"} /></span>
              <div style={{ flex: 1, minWidth: 0 }}><div className="name">{s.name}</div><div className="muted small">{s.type} · good {(s.good_winds || []).join(", ") || "not set"}</div></div>
              <button className="btn sm" aria-label={`Center on ${s.name}`} onClick={() => onCenter(s)}><Icon name="locate" size={18} /></button>
              <button className="btn sm" aria-label={`Edit ${s.name}`} onClick={() => setEdit({ ...s, good_winds: s.good_winds || [] })}><Icon name="edit" size={18} /></button>
            </div>
          );
        })}
      </div>
      {bait.length > 0 && (
        <div className="card">
          <span className="sub-h">Bait & food ({bait.length})</span>
          {bait.map((f) => {
            const days = f.last_filled ? daysBetween(f.last_filled, today) : null;
            return (
              <div key={f.id} className="stand-row">
                <div style={{ flex: 1, minWidth: 0 }}><div className="name">{f.name || FEATURE_TYPES[f.type]}</div>
                  <div className="muted small">{FEATURE_TYPES[f.type]}{days != null ? ` · filled ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}` : ""}</div></div>
                <button className="btn sm" disabled={days === 0} onClick={() => save((d) => d.saveFeature(ground.id, { ...f, last_filled: today }), { ok: "Marked filled today" })}>Filled today</button>
                <button className="btn sm" aria-label="Delete" onClick={() => setConfirm(f.id)}><Icon name="trash" size={18} /></button>
                {confirm === f.id && <div className="confirm" style={{ width: "100%" }}>Delete this site?
                  <div className="btn-row"><button className="btn danger" onClick={() => save((d) => d.deleteFeature(ground.id, f.id), { ok: "Deleted" })}>Delete</button><button className="btn" onClick={() => setConfirm(null)}>Keep</button></div></div>}
              </div>
            );
          })}
          <p className="muted small">Baiting is legal on private land in Kentucky for 2026-27, but not on WMAs/public land, and contact-style feeders are banned in CWD zone counties — check Regulations for your county.</p>
        </div>
      )}
      {cams.length > 0 && (
        <div className="card">
          <span className="sub-h">Trail cameras ({cams.length})</span>
          {cams.map((f, i) => (
            <div key={f.id} className="stand-row" style={{ flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}><div className="name">📷 {f.name || `Trail camera ${i + 1}`}</div></div>
              <button className="btn sm" aria-label="Delete" onClick={() => setConfirm(f.id)}><Icon name="trash" size={18} /></button>
              <div style={{ width: "100%" }}><CamStand stands={stands} value={f.stand_id} onChange={(v) => save((d) => d.saveFeature(ground.id, { ...f, stand_id: v }), { ok: "Camera updated" })} /></div>
              {confirm === f.id && <div className="confirm" style={{ width: "100%" }}>Delete this camera?
                <div className="btn-row"><button className="btn danger" onClick={() => save((d) => d.deleteFeature(ground.id, f.id), { ok: "Deleted" })}>Delete</button><button className="btn" onClick={() => setConfirm(null)}>Keep</button></div></div>}
            </div>
          ))}
          <p className="muted small">Log what your cameras catch while you sit (Hunt Log → Deer seen → On a trail cam). Those deer count toward the forecast check, and toward the linked stand's history in Best stand.</p>
        </div>
      )}
      {other.length > 0 && (
        <div className="card">
          <span className="sub-h">Water / cover / bedding ({other.length})</span>
          {other.map((f) => (
            <div key={f.id} className="stand-row">
              <div style={{ flex: 1, minWidth: 0 }}><div className="name">{f.name || FEATURE_TYPES[f.type]}</div><div className="muted small">{FEATURE_TYPES[f.type]} · {f.radius_yd || 40} yd</div></div>
              <button className="btn sm" aria-label="Delete" onClick={() => setConfirm(f.id)}><Icon name="trash" size={18} /></button>
              {confirm === f.id && <div className="confirm" style={{ width: "100%" }}>Delete this mark?
                <div className="btn-row"><button className="btn danger" onClick={() => save((d) => d.deleteFeature(ground.id, f.id), { ok: "Deleted" })}>Delete</button><button className="btn" onClick={() => setConfirm(null)}>Keep</button></div></div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
