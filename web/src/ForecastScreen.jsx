import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { GroundChip, ThemeButton } from "./Shell.jsx";
import { degToCardinal } from "./lib/geo.js";
import { slopeFrom, slopePoints } from "./lib/terrain.js";
import { cachedForecast, elevations, fetchForecast } from "./lib/weather.js";
import { bestWindows, scoreForecast } from "./lib/model/scoring.js";
import { rank } from "./lib/model/beststand.js";
import { peakFor, rutPeakFor } from "./lib/model/rut.js";
import { dateKey, daysBetween, midnight, parts } from "./lib/model/tz.js";

const RUT_KEY = "deercast.rutOverride";
const tone = (s) => Math.min(4, Math.floor(s / 2)); // → --s0 … --s4 (red → green)
const rating = (s) => (s >= 8 ? "Excellent" : s >= 6.5 ? "Good" : s >= 5 ? "Fair" : "Slow");
const hourLabel = (h) => (h === 0 ? "12 AM" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const hShort = (h) => (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);

function rutPhase(d) {
  if (d < -24) return "Early season · bucks on food patterns";
  if (d < -16) return "Pre-rut · scraping and rubbing";
  if (d < -2) return "Seeking & chasing · best daylight buck movement";
  if (d <= 8) return "Peak breeding · lockdown";
  if (d <= 20) return "Post-rut";
  if (d <= 36) return "Second rut · unbred does";
  return "Late season · food-driven";
}

/** Contiguous legal hours around the best one, within 0.8 of it. */
function windowAround(rows) {
  if (!rows.length) return null;
  const bi = rows.reduce((b, r, i) => (r.score > rows[b].score ? i : b), 0);
  const cut = rows[bi].score - 0.8;
  let a = bi, z = bi;
  while (a > 0 && rows[a - 1].score >= cut && rows[a - 1].hour === rows[a].hour - 1) a--;
  while (z < rows.length - 1 && rows[z + 1].score >= cut && rows[z + 1].hour === rows[z].hour + 1) z++;
  return { from: rows[a].hour, to: rows[z].hour + 1, best: rows[bi] };
}
const span = (w) => {
  const f = (h) => (h % 12 === 0 ? 12 : h % 12);
  const ap = (h) => (h % 24 < 12 ? "AM" : "PM");
  return ap(w.from) === ap(w.to) ? `${f(w.from)}–${f(w.to)} ${ap(w.to)}` : `${f(w.from)} ${ap(w.from)}–${f(w.to)} ${ap(w.to)}`;
};

export default function ForecastScreen({ ground, data, theme, onMenu, demo, active }) {
  const home = ground?.home || { lat: 37.3006, lon: -86.0608, state: "KY" };
  const [fc, setFc] = useState(() => cachedForecast(home.lat, home.lon));
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState(null);
  const [hourSel, setHourSel] = useState(null);
  const [session, setSession] = useState(() => (new Date().getHours() < 11 ? "Morning" : "Evening"));
  const [rutOverride, setRutOverride] = useState(() => localStorage.getItem(RUT_KEY));
  const [rutOpen, setRutOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [slopes, setSlopes] = useState({});

  const load = async (force = false) => {
    setLoading(true); setErr("");
    try { setFc(await fetchForecast(home.lat, home.lon, force)); } catch { setErr("Weather forecast unavailable — check signal"); }
    setLoading(false);
  };
  useEffect(() => { setFc(cachedForecast(home.lat, home.lon)); setDay(null); load(); }, [home.lat, home.lon]);
  useEffect(() => { if (active && fc && Date.now() - fc.at > 3600e3) load(); }, [active]);

  const stands = useMemo(() => data?.stands || [], [data]);
  useEffect(() => {
    if (!stands.length) return;
    const pts = stands.flatMap((s) => slopePoints(s.lat, s.lon));
    elevations(pts).then((el) => setSlopes(Object.fromEntries(stands.map((s, i) => [s.id, slopeFrom(el.slice(5 * i, 5 * i + 5))]))))
      .catch(() => setSlopes({}));
  }, [stands]);

  const tz = fc?.tz || "America/Chicago";
  const today = dateKey(Date.now(), tz);
  const rutInfo = peakFor(home.state, home.lat, home.lon);
  const rutPeak = rutPeakFor(today, home.lat, home.lon, home.state, rutOverride);
  const scored = useMemo(() => (fc ? scoreForecast(fc.rows, home.lat, home.lon, tz,
    { rutPeak, start: midnight(today, tz), today }) : []), [fc, rutPeak, today, tz, home.lat, home.lon]);
  const daily = useMemo(() => bestWindows(scored), [scored]);
  const sel = day && daily.some((d) => d.date === day) ? day : daily[0]?.date;
  const rows = useMemo(() => scored.filter((r) => r.date === sel), [scored, sel]);
  const dsum = daily.find((d) => d.date === sel);
  const legal = rows.filter((r) => r.legal);
  const am = windowAround(legal.filter((r) => r.hour < 12)), pm = windowAround(legal.filter((r) => r.hour >= 12));
  const best = dsum ? rows.find((r) => r.time === dsum.bestHour) : null;
  const shown = hourSel != null && rows[hourSel] ? rows[hourSel] : best;
  const nowHour = rows.find((r) => r.date === today && r.hour === parts(Date.now(), tz).h);
  const ranked = useMemo(() => (stands.length && rows.length ? rank(stands, rows, session, data?.hunts || [], slopes) : []),
    [stands, rows, session, data, slopes]);

  const setRut = (v) => {
    const mmdd = v ? v.slice(5) : null;
    const def = `${String(rutInfo.month).padStart(2, "0")}-${String(rutInfo.day).padStart(2, "0")}`;
    const o = mmdd && mmdd !== def ? mmdd : null;
    setRutOverride(o);
    if (o) localStorage.setItem(RUT_KEY, o); else localStorage.removeItem(RUT_KEY);
  };
  const dayName = (k) => (k === today ? "Today" : daysBetween(today, k) === 1 ? "Tomorrow"
    : new Date(midnight(k, tz) + 12 * 3600e3).toLocaleDateString([], { weekday: "short", timeZone: tz }));
  const longDate = (k) => new Date(midnight(k, tz) + 12 * 3600e3).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", timeZone: tz });
  const clock = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—");
  const dRut = sel ? daysBetween(sel, rutPeak) : 0;

  return (
    <div className="page" style={{ display: active ? undefined : "none" }}>
      <header className="page-top">
        <GroundChip ground={ground} onClick={onMenu} demo={demo} />
        <span className="spacer" />
        <ThemeButton theme={theme} />
      </header>

      <div className="page-title">
        <span className="label">{sel ? longDate(sel) : " "}</span>
        <h1>Deer activity</h1>
      </div>

      {!fc && <div className="card muted">{err || "Getting the 14-day forecast…"}</div>}
      {fc && (
        <>
          <div className="days" role="tablist" aria-label="Day">
            {daily.map((d) => (
              <button key={d.date} role="tab" aria-selected={d.date === sel} className={`daychip ${d.date === sel ? "on" : ""}`}
                onClick={() => { setDay(d.date); setHourSel(null); }}>
                <span className="dn">{dayName(d.date)}</span>
                <span className="big ds" style={{ color: `var(--s${tone(d.bestScore)}-text)` }}>{d.bestScore.toFixed(1)}</span>
              </button>
            ))}
          </div>

          {dsum && (
            <section className="card hero">
              <div className="hero-top">
                <div>
                  <span className="label">{sel === today && nowHour ? `Now ${nowHour.score.toFixed(1)} · best today` : "Best hour"}</span>
                  <div className="score-line"><span className="big" style={{ fontSize: 48, color: "var(--accent-text)" }}>{dsum.bestScore.toFixed(1)}</span>
                    <span className="rating">{rating(dsum.bestScore)}</span></div>
                </div>
                <div className="windows">
                  <span className="label">Best windows</span>
                  <span>{am ? span(am) : "—"}</span>
                  <span>{pm ? span(pm) : "—"}</span>
                </div>
              </div>
              <div className="bars" aria-label="Hourly activity">
                {rows.map((r, i) => (
                  <button key={r.time} className={`bar ${hourSel === i ? "sel" : ""}`} aria-label={`${hourLabel(r.hour)} score ${r.score}`}
                    onClick={() => setHourSel(hourSel === i ? null : i)}>
                    <span style={{ height: `${8 + r.score * 6.4}px`, background: r.legal ? `var(--s${tone(r.score)})` : "var(--line)" }} />
                  </button>
                ))}
              </div>
              <div className="wx-strip">
                {rows.map((r, i) => (
                  <div key={r.time} className="wx">
                    {i % 3 === 0 && <>
                      <span className="t">{Math.round(r.temp_f)}°</span>
                      <svg viewBox="0 0 24 24" className="arrow" style={{ transform: `rotate(${(r.wind_dir + 180) % 360}deg)` }} aria-hidden="true"><path d="M12 20V5M6 10l6-6 6 6" /></svg>
                      <span className="h">{hShort(r.hour)}</span>
                    </>}
                  </div>
                ))}
              </div>
              <div className="sun-line muted small">Sunrise {clock(rows[0]?.sunrise)} · Sunset {clock(rows[0]?.sunset)} · grey = outside legal hours</div>
              {shown && (
                <div className="hour-detail">
                  <div><b>{hourLabel(shown.hour)}</b> <span className="big" style={{ fontSize: 22, color: `var(--s${tone(shown.score)}-text)` }}>{shown.score.toFixed(1)}</span>
                    {!shown.legal && <span className="muted small"> · not legal</span>}</div>
                  <div className="muted small">
                    {Math.round(shown.temp_f)}°F · wind {degToCardinal(shown.wind_dir)} {Math.round(shown.wind_mph)} (gusts {Math.round(shown.gust_mph)})
                    {" · "}{Math.round(shown.sky_pct ?? shown.cloud_pct)}% overcast{shown.precip_prob != null ? ` · ${Math.round(shown.precip_prob)}% rain` : ""}
                    {" · "}{shown.pressure_inhg.toFixed(2)} inHg {shown.p_tend_3h >= 0.03 ? "rising" : shown.p_tend_3h <= -0.02 ? "falling" : "steady"}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="card">
            <div className="row-head">
              <span className="h2">Best stand</span>
              <div className="seg small-seg">
                {["Morning", "Evening"].map((s) => <button key={s} className={session === s ? "on" : ""} onClick={() => setSession(s)}>{s}</button>)}
              </div>
            </div>
            {!stands.length && <p className="muted small">Add stands on the Map page and they'll be ranked here.</p>}
            {stands.length > 0 && !ranked.length && <p className="muted small">No legal hours in this window.</p>}
            {ranked.map((r, i) => (
              <div className="rank-row" key={r.stand.id}>
                <span className={`rank ${i === 0 ? "first" : ""}`}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{r.stand.name}</div>
                  <div className="muted small">{r.reasons.join(" · ")}</div>
                </div>
                <span className="big" style={{ fontSize: 24, color: `var(--s${tone(r.score)}-text)` }}>{r.score.toFixed(1)}</span>
              </div>
            ))}
          </section>

          {best && (
            <section className="card">
              <span className="h2">Conditions</span>
              <button className="factor" onClick={() => setRutOpen(!rutOpen)}>
                <span className="fi"><Icon name="heart" /></span>
                <span className="fx"><span className="name">Rut</span><span className="muted small">{rutPhase(-dRut)}</span></span>
                <span className="fv">{dRut > 0 ? `${dRut} days to peak` : dRut === 0 ? "Peak" : `${-dRut} days after`}</span>
              </button>
              {rutOpen && (
                <div className="rut-edit">
                  <label className="small">Peak breeding date
                    <input type="date" value={rutPeak} onChange={(e) => setRut(e.target.value)} />
                  </label>
                  <div className="muted small">{rutOverride ? "Your date. " : ""}Default {rutInfo.month}/{rutInfo.day}: {rutInfo.source}
                    {rutInfo.url && <> · <a href={rutInfo.url} target="_blank" rel="noreferrer">source</a></>}</div>
                  {rutOverride && <button className="link" onClick={() => setRut(null)}>Reset to default</button>}
                </div>
              )}
              <div className="factor"><span className="fi"><Icon name="moon" /></span>
                <span className="fx"><span className="name">Moon</span><span className="muted small">{best.moonName}</span></span>
                <span className="fv">{Math.round(best.moon_illum * 100)}%</span></div>
              <div className="factor"><span className="fi"><Icon name="gauge" /></span>
                <span className="fx"><span className="name">Pressure</span><span className="muted small">{best.p_tend_3h >= 0.03 ? "Rising" : best.p_tend_3h <= -0.02 ? "Falling" : "Steady"} at the best hour</span></span>
                <span className="fv">{best.pressure_inhg.toFixed(2)} inHg</span></div>
              <div className="factor"><span className="fi"><Icon name="therm" /></span>
                <span className="fx"><span className="name">Temperature</span><span className="muted small">{Number.isNaN(best.dtemp_24h) ? "—" : `${best.dtemp_24h >= 0 ? "+" : ""}${Math.round(best.dtemp_24h)}° vs. yesterday`}</span></span>
                <span className="fv">{Math.round(dsum.hi)}° / {Math.round(dsum.lo)}°</span></div>
              <div className="factor"><span className="fi"><Icon name="wind" /></span>
                <span className="fx"><span className="name">Wind</span><span className="muted small">At the best hour · gusts {Math.round(best.gust_mph)}</span></span>
                <span className="fv">{degToCardinal(best.wind_dir)} {Math.round(best.wind_mph)} mph</span></div>
              <button className="link" onClick={() => setWhyOpen(!whyOpen)}>Why this score? {whyOpen ? "▴" : "▾"}</button>
              {whyOpen && shown && (
                <div className="why small">
                  <p className="muted">{hourLabel(shown.hour)}: factors multiply; 1.00 is neutral.</p>
                  {[["Time of day", shown.f_diel], ["Season / rut", shown.f_season], ["Temperature", shown.f_temp], ["Pressure", shown.f_pressure],
                    ["Wind", shown.f_wind], ["Rain", shown.f_precip], ["Cloud", shown.f_cloud], ["Solunar", shown.f_solunar]].map(([n, v]) => (
                    <div key={n} className="why-row"><span>{n}</span><span className={v > 1.001 ? "up" : v < 0.999 ? "down" : ""}>{v.toFixed(2)}</span></div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="card">
            <span className="h2">14 days</span>
            <div className="list-head muted small"><span>Day</span><span>AM</span><span>PM</span><span>Hi/Lo</span></div>
            {daily.map((d) => (
              <button key={d.date} className={`day-row ${d.date === sel ? "on" : ""}`} onClick={() => { setDay(d.date); setHourSel(null); document.querySelector(".page")?.scrollTo({ top: 0, behavior: "smooth" }); }}>
                <span className="dn">{dayName(d.date)} <span className={`conf ${d.confidence.toLowerCase()}`} title={`${d.confidence} confidence`} /></span>
                <span className="pill" style={{ background: Number.isNaN(d.amScore) ? "var(--line)" : `var(--s${tone(d.amScore)})` }}>{Number.isNaN(d.amScore) ? "—" : d.amScore.toFixed(1)}</span>
                <span className="pill" style={{ background: Number.isNaN(d.pmScore) ? "var(--line)" : `var(--s${tone(d.pmScore)})` }}>{Number.isNaN(d.pmScore) ? "—" : d.pmScore.toFixed(1)}</span>
                <span className="muted">{Math.round(d.hi)}°/{Math.round(d.lo)}°</span>
              </button>
            ))}
            <p className="muted small">Dot = forecast confidence: solid (days 1–3), half (4–7), hollow (8–14).</p>
          </section>
          <div className="foot muted small">
            Updated {new Date(fc.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            {" · "}<button className="link" onClick={() => load(true)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
            {err && <div className="err">{err}</div>}
          </div>
        </>
      )}
    </div>
  );
}
