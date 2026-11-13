// More → Who's hunting: everyone with a sit going right now (any ground), and a read-only "watch" view of one.
// The sits are other people's active_hunt docs; row-level security lets approved users read them, never change them.
import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import PhotoStrip from "./Photos.jsx";
import { HuntClock, fmtClock } from "./HuntLogScreen.jsx";
import { deerText, groupSightings, isCamera, whereText } from "./lib/huntlog.js";
import { dailyAstro } from "./lib/model/astro.js";
import { dateKey } from "./lib/model/tz.js";

const TZ = "America/Chicago";
const REFRESH_S = 30;
const sinceText = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };

export default function WhosHunting({ db, ground, active }) {
  const [sits, setSits] = useState(null);
  const [names, setNames] = useState({});
  const [watch, setWatch] = useState(null); // owner email
  const [at, setAt] = useState(null);
  useEffect(() => {
    if (!active) return;
    const load = () => Promise.all([db.listLiveSits(), db.listUsers().catch(() => [])])
      .then(([xs, us]) => { setSits(xs.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))); setNames(Object.fromEntries(us.map((u) => [u.email, u.name || u.email]))); setAt(Date.now()); })
      .catch(() => setSits((s) => s || []));
    load();
    const i = setInterval(load, REFRESH_S * 1000);
    return () => clearInterval(i);
  }, [active, db]);

  if (sits === null) return <p className="muted">Loading…</p>;
  const w = watch && sits.find((s) => s.owner === watch);
  if (watch && !w) return (
    <section className="card"><p>{names[watch] || watch} isn't hunting any more — the sit was ended or saved.</p>
      <button className="btn" onClick={() => setWatch(null)}>Back to the list</button></section>
  );
  if (w) return <Watch sit={w} name={names[w.owner] || w.owner} db={db} home={ground?.home} at={at} onBack={() => setWatch(null)} />;
  return (
    <section className="card">
      {!sits.length && <p className="muted">Nobody else has a sit going right now.</p>}
      {sits.map((o) => {
        const n = (o.sightings || []).filter((x) => !isCamera(x)).reduce((k, x) => k + (+x.count || 1), 0);
        return (
          <div key={o.owner} className="hunt">
            <button className="hunt-row" onClick={() => setWatch(o.owner)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">🟢 {names[o.owner] || o.owner}</div>
                <div className="muted small">{String(o.where || "").replace("Stand: ", "")}{o.ground_name ? ` · ${o.ground_name}` : ""} · {sinceText(Date.parse(o.start))} on stand · {n} deer</div>
              </div>
              <Icon name="chev" style={{ transform: "rotate(-90deg)" }} />
            </button>
          </div>
        );
      })}
      <p className="muted small">Tap a name to watch their sit. View only — updates every {REFRESH_S} seconds.</p>
    </section>
  );
}

function Watch({ sit: o, name, db, home, at, onBack }) {
  const start = Date.parse(o.start);
  const spot = o.spot || (o.lat != null ? [o.lat, o.lon] : home ? [home.lat, home.lon] : null);
  let t = null;
  if (spot) { const key = dateKey(start, TZ), a = dailyAstro(spot[0], spot[1], [key], TZ)[key]; t = { legalStart: a.sunrise - 30 * 60000, sunrise: a.sunrise, sunset: a.sunset, legalEnd: a.sunset + 30 * 60000 }; }
  const groups = groupSightings(o.sightings || []);
  return (
    <>
      <button className="chip" onClick={onBack}><Icon name="chev" size={16} style={{ transform: "rotate(90deg)" }} /><span>Everyone hunting</span></button>
      <section className="card">
        <span className="h2">🟢 {name}</span>
        <p className="muted small">{String(o.where || "").replace("Stand: ", "")}{o.ground_name ? ` · ${o.ground_name}` : ""} · since {fmtClock(start, TZ)}{o.weapon ? ` · ${o.weapon}` : ""}</p>
        {t ? <HuntClock start={start} t={t} tz={TZ} /> : <p><b>On stand {sinceText(start)}</b></p>}
        <div className="sub-h">Deer seen</div>
        {!groups.length && <p className="muted small">No deer logged yet.</p>}
        {[...groups].reverse().map((g) => (
          <div key={g.group} className="small">• {fmtClock(Date.parse(g.time), TZ)} — {deerText(g.deer)}{g.source === "camera" ? ` (📷 ${g.camera || "trail cam"})` : ""}{g.activity ? `, ${g.activity}` : ""}{g.bait ? `, at ${g.bait}` : ""}{whereText(g) ? ` (${whereText(g)})` : ""}</div>
        ))}
        {(o.photos || []).length > 0 && <><div className="sub-h">Photos</div>
          <PhotoStrip db={db} photos={o.photos} sightings={o.sightings || []} groundId={o.ground_id} tz={TZ} canEdit={false} /></>}
        {o.notes && <><div className="sub-h">Notes</div><p className="small"><i>{o.notes}</i></p></>}
        <p className="muted small">View only · updated {at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""} · refreshes every {REFRESH_S} s.</p>
      </section>
    </>
  );
}
