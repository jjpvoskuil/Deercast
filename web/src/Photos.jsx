// Photos on a hunt: a strip of thumbnails + "Add photo" (camera or photo library), a sheet to caption it and say which
// deer it goes with, and a full-screen viewer. Photo records live on the hunt (hunt.photos); the pictures themselves
// live in Supabase Storage (lib/photos.js).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { newId, nowIso } from "./lib/db.js";
import { deerText, groupSightings } from "./lib/huntlog.js";
import { myLocation } from "./lib/places.js";
import { photoPath, shrinkPhoto, thumbPath } from "./lib/photos.js";

// signed links, cached for the session (they last 6 h)
const urlCache = new Map();
export function usePhotoUrls(db, paths) {
  const [, bump] = useState(0);
  const key = paths.join("|");
  useEffect(() => {
    const need = paths.filter((p) => !urlCache.has(p));
    if (!need.length || !db?.photoUrls) return;
    let stop = false;
    db.photoUrls(need).then((m) => { for (const [p, u] of Object.entries(m)) urlCache.set(p, u); if (!stop) bump((n) => n + 1); }).catch(() => {});
    return () => { stop = true; };
  }, [key]);
  return (p) => urlCache.get(p);
}

const fmtWhen = (iso, tz) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) : "");

/** photos: this hunt's list · onChange(newList) saves it · live = taken right now (time + GPS) · canEdit = it's yours */
export default function PhotoStrip({ db, photos = [], sightings = [], groundId, tz, live = false, canEdit = true, onChange, toast,
  caption = "", extra = null, addLabel = null }) {
  const input = useRef(null);
  const [draft, setDraft] = useState(null);   // { file, preview, caption, group }
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);     // photo being viewed
  // While the photo sheet/viewer is up, the app under it can't take taps (iPhone Safari sometimes sends taps
  // through to the scrolling page underneath — the "frozen buttons" problem).
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root || !(draft || view)) return;
    root.inert = true;
    return () => { root.inert = false; };
  }, [!!(draft || view)]);
  const [confirmDel, setConfirmDel] = useState(false);
  const groups = groupSightings(sightings);
  const url = usePhotoUrls(db, photos.flatMap((p) => [thumbPath(p.path)]));
  const fullUrl = usePhotoUrls(db, view ? [view.path] : []);
  const withDeer = (g) => { const s = groups.find((x) => x.group === g); return s ? deerText(s.deer) : null; };
  const label = (g) => { const s = groups.find((x) => x.group === g); return s ? `${deerText(s.deer)} · ${fmtWhen(s.time, tz)}` : null; };

  const pick = (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    // a photo taken during a sit goes with the deer you saved in the last 15 minutes, if any
    const recent = live ? [...groups].reverse().find((g) => Date.now() - Date.parse(g.time) < 15 * 60e3) : null;
    setDraft({ file, preview: URL.createObjectURL(file), caption, group: recent?.group || "" });
  };
  const close = () => { if (draft?.preview) URL.revokeObjectURL(draft.preview); setDraft(null); };
  const saveDraft = async () => {
    setBusy(true);
    try {
      const { full, thumb, w, h } = await shrinkPhoto(draft.file);
      const id = newId(), path = photoPath(groundId, db.email, id);
      let at = {};
      if (live) { try { const p = await myLocation(); at = { lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 }; } catch { /* no GPS: fine */ } }
      if (at.lat == null && draft.group) { const s = groups.find((x) => x.group === draft.group); if (s?.lat != null) at = { lat: s.lat, lon: s.lon, at_deer: true }; }
      await db.uploadPhoto(thumbPath(path), thumb);
      await db.uploadPhoto(path, full);
      const rec = { id, path, w, h, caption: draft.caption.trim(), group: draft.group || null, added: nowIso(), ...(live ? { time: nowIso() } : {}), ...at, ...(extra || {}) };
      await onChange([...photos, rec]);
      toast?.("Photo saved");
      close();
    } catch (e) { toast?.(`Couldn't save the photo — ${e.message}`); }
    setBusy(false);
  };
  const remove = async (p) => {
    setBusy(true);
    try { await onChange(photos.filter((x) => x.id !== p.id)); await db.deletePhotos([p.path, thumbPath(p.path)]).catch(() => {}); setView(null); setConfirmDel(false); }
    catch (e) { toast?.(`Couldn't delete — ${e.message}`); }
    setBusy(false);
  };
  const edit = async (p, patch) => { const n = { ...p, ...patch }; await onChange(photos.map((x) => (x.id === p.id ? n : x))); setView(n); };

  return (
    <div className="photos">
      {(photos.length > 0 || canEdit) && (
        <div className="photo-strip">
          {photos.map((p) => (
            <button key={p.id} className="photo-thumb" onClick={() => setView(p)} aria-label={p.caption || "Photo"}>
              {url(thumbPath(p.path)) ? <img src={url(thumbPath(p.path))} alt="" loading="lazy" /> : <span className="muted small">…</span>}
            </button>
          ))}
          {canEdit && <button className="photo-thumb add" onClick={() => input.current?.click()}><span>📷</span><span className="small">{addLabel || (live ? "Photo" : "Add photo")}</span></button>}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />

      {draft && createPortal(
        <div className="overlay photo-sheet" role="dialog" aria-label="New photo">
          <div className="photo-sheet-body">
            <img className="photo-preview" src={draft.preview} alt="" />
            <label className="field"><span>Caption (optional)</span>
              <input value={draft.caption} placeholder="e.g. 8-point at the feeder" onChange={(e) => setDraft({ ...draft, caption: e.target.value })} /></label>
            {groups.length > 0 && (
              <label className="field"><span>Goes with</span>
                <select value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })}>
                  <option value="">— nothing in particular</option>
                  {groups.map((g) => <option key={g.group} value={g.group}>{label(g.group)}</option>)}
                </select></label>
            )}
            <div className="btn-row">
              <button className="btn primary" disabled={busy} onClick={saveDraft}>{busy ? "Saving…" : "Save photo"}</button>
              <button className="btn" disabled={busy} onClick={close}>Cancel</button>
            </div>
          </div>
        </div>, document.body)}

      {view && createPortal(
        <div className="overlay photo-view" role="dialog" aria-label="Photo">
          <div className="photo-view-top"><button className="btn sm" onClick={() => { setView(null); setConfirmDel(false); }}>✕ Close</button></div>
          <div className="photo-view-img">{fullUrl(view.path) || url(thumbPath(view.path))
            ? <img src={fullUrl(view.path) || url(thumbPath(view.path))} alt={view.caption || ""} /> : <span className="muted">Loading…</span>}</div>
          <div className="photo-view-info">
            {canEdit ? <input className="photo-caption" value={view.caption || ""} placeholder="Add a caption"
              onChange={(e) => setView({ ...view, caption: e.target.value })} onBlur={(e) => e.target.value !== (photos.find((x) => x.id === view.id)?.caption || "") && edit(view, { caption: e.target.value.trim() })} />
              : view.caption && <b>{view.caption}</b>}
            <div className="muted small">{[fmtWhen(view.time, tz), withDeer(view.group) && `with ${withDeer(view.group)}`].filter(Boolean).join(" · ")}</div>
            {canEdit && (confirmDel
              ? <div className="btn-row"><button className="btn danger" disabled={busy} onClick={() => remove(view)}>Yes, delete photo</button><button className="btn" onClick={() => setConfirmDel(false)}>Keep</button></div>
              : <button className="btn sm" onClick={() => setConfirmDel(true)}>Delete photo</button>)}
          </div>
        </div>, document.body)}
    </div>
  );
}
