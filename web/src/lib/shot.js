// Shot analysis — JavaScript copy of deercast/shot.py (anatomy ellipsoids, arrow ray-cast, outcomes). Parity: shot.test.js.
// Deer body frame (inches): x forward (toward head), y deer's LEFT, z up; origin = torso center. Left side faces shooter;
// a right-side shot mirrors the picture. yaw: 0 broadside, + quartering away, − quartering toward. pitch: downward angle.
const P = (key, label, center, semi, kind, color = "#999999") => ({ key, label, center, semi, kind, color });

export const BODY = [
  P("torso", "Torso", [0, 0, 0], [20, 8, 10], "body", "#a87a4f"),
  P("ham_l", "Left ham", [-16, 4.5, -3], [7.5, 3.8, 10], "body", "#9c6f45"),
  P("ham_r", "Right ham", [-16, -4.5, -3], [7.5, 3.8, 10], "body", "#8d6440"),
  P("neck_base", "Neck (base)", [17, 0, 4], [7, 5.5, 8], "body", "#a87a4f"),
  P("neck", "Neck", [25, 0, 11], [7.5, 4, 5], "body", "#a87a4f"),
  P("head", "Head", [34, 0, 17.5], [6.5, 3.4, 3.8], "body", "#9c6f45"),
  P("upper_fl", "Front upper leg (L)", [14, 4.6, -8], [4.2, 2.8, 8], "body", "#9c6f45"),
  P("upper_fr", "Front upper leg (R)", [14, -4.6, -8], [4.2, 2.8, 8], "body", "#8d6440"),
  P("leg_fl", "Front leg (L)", [14, 4, -22], [1.8, 1.7, 14], "body", "#7e5a3a"),
  P("leg_fr", "Front leg (R)", [14, -4, -22], [1.8, 1.7, 14], "body", "#6e4f33"),
  P("leg_rl", "Hind leg (L)", [-18, 4, -22], [2.1, 1.9, 14], "body", "#7e5a3a"),
  P("leg_rr", "Hind leg (R)", [-18, -4, -22], [2.1, 1.9, 14], "body", "#6e4f33"),
];
export const ORGANS = [
  P("brain", "Brain", [35.5, 0, 19], [2.5, 1.8, 1.8], "organ", "#f0c0d0"),
  P("spine", "Spine", [2, 0, 8.6], [24, 1.1, 1.1], "bone", "#f2efe6"),
  P("neck_spine", "Neck spine", [23, 0, 12], [9, 1.1, 1.1], "bone", "#f2efe6"),
  P("neck_vessels", "Windpipe / carotid / jugular", [23, 0, 8], [9, 1.6, 1.6], "organ", "#d0505a"),
  P("aorta", "Aorta & major vessels", [4, 0, 6.6], [15, 1.0, 1.0], "organ", "#c0202a"),
  P("heart", "Heart", [12.5, 0, -4.5], [3, 2.4, 3.2], "organ", "#d7261e"),
  P("lung_l", "Left lung", [9, 3.2, 1.5], [7.5, 3.2, 6], "organ", "#f08a96"),
  P("lung_r", "Right lung", [9, -3.2, 1.5], [7.5, 3.2, 6], "organ", "#f08a96"),
  P("liver", "Liver", [-0.5, -1.5, -0.5], [3.2, 5.5, 6.5], "organ", "#7a1f2b"),
  P("kidneys", "Kidneys", [-7.5, 0, 6], [2, 4.2, 1.8], "organ", "#9a3b3b"),
  P("rumen", "Stomach (rumen)", [-8, 2, -2], [8, 5.5, 6.5], "organ", "#7f9a52"),
  P("intestines", "Intestines", [-11, -2.5, -4.5], [5.5, 4.5, 4.5], "organ", "#a8a060"),
  P("femoral_l", "Femoral artery (L)", [-16, 4.5, -8], [2, 1.2, 4], "organ", "#c0202a"),
  P("femoral_r", "Femoral artery (R)", [-16, -4.5, -8], [2, 1.2, 4], "organ", "#c0202a"),
  P("shoulder_l", "Shoulder blade / leg bone (L)", [13.5, 6.4, -1], [5, 1.5, 7.5], "bone", "#e8e2d0"),
  P("shoulder_r", "Shoulder blade / leg bone (R)", [13.5, -6.4, -1], [5, 1.5, 7.5], "bone", "#e8e2d0"),
];
export const DECOR = [
  P("ear_l", "", [31, 3, 22.5], [1.4, 0.8, 3.4], "body", "#8d6440"), P("ear_r", "", [31, -3, 22.5], [1.4, 0.8, 3.4], "body", "#7e5a3a"),
  P("tail", "", [-21, 0, 5], [1.6, 1.3, 3.2], "body", "#f2efe6"), P("nose", "", [40, 0, 16], [1.4, 1.3, 1.3], "body", "#2a2018"),
  P("eye_l", "", [36.5, 2.9, 19], [0.8, 0.4, 0.7], "body", "#1a1410"), P("eye_r", "", [36.5, -2.9, 19], [0.8, 0.4, 0.7], "body", "#1a1410"),
  P("hoof_fl", "", [14.5, 4, -35.5], [2, 1.6, 1], "body", "#2a2018"), P("hoof_fr", "", [14.5, -4, -35.5], [2, 1.6, 1], "body", "#2a2018"),
  P("hoof_rl", "", [-16.5, 4, -35.5], [2, 1.6, 1], "body", "#2a2018"), P("hoof_rr", "", [-16.5, -4, -35.5], [2, 1.6, 1], "body", "#2a2018"),
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(...a);
const scale = (a, k) => a.map((x) => x * k);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);

/** [d, r, u]: arrow direction, screen-right, screen-up (left-side model frame). */
export function viewBasis(yaw, pitch) {
  const th = (yaw * Math.PI) / 180, ph = (pitch * Math.PI) / 180;
  const d = [Math.sin(th) * Math.cos(ph), -Math.cos(th) * Math.cos(ph), -Math.sin(ph)];
  let r = cross(d, [0, 0, 1]);
  if (norm(r) < 1e-6) r = [-1, 0, 0];
  r = scale(r, 1 / norm(r));
  let u = cross(r, d);
  u = scale(u, 1 / norm(u));
  return [d, r, u];
}

export function rayInterval(p0, d, part) {
  const o = p0.map((x, i) => (x - part.center[i]) / part.semi[i]);
  const v = d.map((x, i) => x / part.semi[i]);
  const A = dot(v, v), B = 2 * dot(o, v), C = dot(o, o) - 1;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

/** Trace the arrow from screen point (sx, sy) in the shooter's view. */
export function trace(sx, sy, yaw, pitch) {
  const [d, r, u] = viewBasis(yaw, pitch);
  const p0 = sub(add(scale(r, sx), scale(u, sy)), scale(d, 200));
  const ivs = [];
  for (const p of BODY) { const iv = rayInterval(p0, d, p); if (iv) ivs.push([iv[0], iv[1], p.key]); }
  if (!ivs.length) return { entry: null, exit: null, hits: [], boneFirst: null, bodyParts: [], missed: true };
  ivs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  let [tEntry, tExit] = ivs[0];
  const parts = [ivs[0][2]];
  for (const [a, b, k] of ivs.slice(1)) { if (a <= tExit + 1.0) { tExit = Math.max(tExit, b); parts.push(k); } else break; }
  const res = { entry: add(p0, scale(d, tEntry)), exit: add(p0, scale(d, tExit)), hits: [], boneFirst: null, bodyParts: parts, missed: false };
  for (const p of ORGANS) {
    const iv = rayInterval(p0, d, p);
    if (!iv) continue;
    const a = Math.max(iv[0], tEntry), b = Math.min(iv[1], tExit);
    if (b - a > 0.15) res.hits.push({ key: p.key, label: p.label, kind: p.kind, tIn: a, tOut: b, length: b - a, afterBone: false });
  }
  res.hits.sort((a, b) => a.tIn - b.tIn);
  const bones = res.hits.filter((h) => h.key.startsWith("shoulder"));
  if (bones.length) { res.boneFirst = bones[0]; for (const h of res.hits) h.afterBone = h !== bones[0] && h.tIn > bones[0].tIn; }
  return res;
}
const keysOf = (res, includeAfterBone = true) => new Set(res.hits.filter((h) => includeAfterBone || !h.afterBone).map((h) => h.key));

// Typical outcomes — see docs/SHOT_MODEL.md. Generalizations; individual deer vary a lot.
export const OUTCOMES = {
  brain: { title: "Brain / CNS", lethal: true, time: "Instant", wait_min: 0, yards: [0, 5, 20], blood: "Little blood needed — deer drops on the spot.",
    tips: ["Approach carefully from behind; be ready for a follow-up shot if the deer moves."] },
  spine: { title: "Spine", lethal: true, time: "Drops immediately (may be alive & paralyzed)", wait_min: 0, yards: [0, 5, 20], blood: "Often minimal; deer goes down in its tracks.",
    tips: ["Deer may be paralyzed but alive — make an immediate, safe follow-up shot.", "A high back shot that only nicks the spine can stun the deer; it may get back up and run."] },
  heart: { title: "Heart", lethal: true, time: "Seconds to ~1 minute", wait_min: 30, yards: [20, 60, 120],
    blood: "Heavy blood, often starting a few yards after the shot; may be dark-to-bright red. Classic 'mule kick' reaction, then a hard, low run.",
    tips: ["Wait ~30 minutes, then track. Expect a short, heavy trail.", "Blood may be sparse for the first 10–30 yd until the chest cavity fills."] },
  aorta: { title: "Aorta / major vessels", lethal: true, time: "Under 1 minute", wait_min: 30, yards: [20, 60, 120], blood: "Heavy bright-red blood.",
    tips: ["Wait ~30 minutes. Trail should be obvious and short."] },
  double_lung: { title: "Double lung", lethal: true, time: "~10 seconds to 1–2 minutes", wait_min: 30, yards: [30, 80, 150],
    blood: "Bright red, pinkish and frothy with bubbles; may be sprayed on both sides of the trail. Deer often kicks or bolts hard, then slows.",
    tips: ["Wait 30 minutes, then track quietly.", "Look for blood on brush at chest height as well as on the ground."] },
  femoral: { title: "Femoral artery (hindquarter)", lethal: true, time: "1–3 minutes if the artery is cut", wait_min: 30, yards: [40, 100, 200],
    blood: "Very heavy, bright-red spray — hard to miss.",
    tips: ["Wait ~30 minutes. If blood quickly tapers off, the artery may have been missed — back out and wait several hours (muscle hit)."] },
  neck_vessels: { title: "Neck — windpipe / major vessels", lethal: true, time: "Minutes (if carotid/jugular cut)", wait_min: 60, yards: [30, 120, 300],
    blood: "Heavy bright-red if a major vessel is cut; frothy if the windpipe is hit.",
    tips: ["Wait ~1 hour. If blood fades fast it was likely muscle only — back out, wait 4+ hours.", "Neck shots are inconsistent: a muscle-only neck hit usually means a deer that survives."] },
  single_lung: { title: "Single lung", lethal: false, time: "Hours — some deer survive", wait_min: 240, yards: [150, 400, 900],
    blood: "Bright red, some bubbles at first, often thinning out quickly.",
    tips: ["Wait at least 4 hours (overnight is safer).", "Trails are often long; be ready to grid-search ahead of last blood.", "Many single-lung deer are not recovered — mark last blood carefully and get help."] },
  kidneys: { title: "Kidneys", lethal: true, time: "Minutes to ~1 hour (very vascular)", wait_min: 60, yards: [50, 150, 300], blood: "Dark red, can be heavy.",
    tips: ["Wait 1–2 hours, then track."] },
  liver: { title: "Liver", lethal: true, time: "1–4 hours", wait_min: 300, yards: [80, 200, 400], blood: "Dark red (maroon) blood, moderate amount, no bubbles.",
    tips: ["Wait 4–6 hours before tracking. Liver-hit deer usually bed within 200 yards if not pushed.", "If you jump the deer, stop, mark the spot and back out quietly — wait several more hours."] },
  paunch: { title: "Stomach / intestines (gut shot)", lethal: true, time: "8–16+ hours", wait_min: 600, yards: [100, 250, 500],
    blood: "Sparse, dark, may contain green/brown matter or have a foul smell; arrow smells and is greasy.",
    tips: ["Wait at least 8–12 hours — overnight for an evening shot. Pushing a gut-shot deer early is the #1 way to lose it.",
      "Gut-shot deer usually bed in the nearest thick cover, often downhill and toward water.", "Start where the deer was hit and walk slowly; look for bedding spots with blood."] },
  muscle: { title: "Muscle / non-vital", lethal: false, time: "Usually survives", wait_min: 120, yards: [100, 500, 1500], blood: "Can start heavy then stop quickly; bright red, no bubbles.",
    tips: ["Wait 1–2 hours, then follow the blood until it stops.", "If the trail dries up, the deer will most likely recover — note where it ended."] },
  shoulder_only: { title: "Shoulder bone (no vitals reached)", lethal: false, time: "Usually survives", wait_min: 120, yards: [100, 500, 1500],
    blood: "Little blood; limited penetration; deer often runs off normally.",
    tips: ["With a bow, heavy shoulder bone often stops the arrow before the vitals.", "Track for sign, but most deer hit only in the shoulder blade recover."] },
  miss: { title: "Miss (no body hit)", lethal: false, time: "—", wait_min: 0, yards: [0, 0, 0], blood: "None expected.",
    tips: ["Still check the impact area and the arrow for hair or blood to confirm a clean miss."] },
};
export const PRIORITY = ["brain", "spine", "heart", "aorta", "double_lung", "femoral", "neck_vessels", "kidneys", "liver", "single_lung", "paunch", "shoulder_only", "muscle", "miss"];

export function foundFromKeys(k) {
  const out = new Set();
  const lungs = ["lung_l", "lung_r"].filter((x) => k.has(x)).length;
  if (lungs === 2) out.add("double_lung"); else if (lungs === 1) out.add("single_lung");
  for (const [key, grp] of [["heart", ["heart"]], ["aorta", ["aorta"]], ["liver", ["liver"]], ["kidneys", ["kidneys"]], ["paunch", ["rumen", "intestines"]],
    ["spine", ["spine", "neck_spine"]], ["femoral", ["femoral_l", "femoral_r"]], ["neck_vessels", ["neck_vessels"]], ["brain", ["brain"]]]) {
    if (grp.some((g) => k.has(g))) out.add(key);
  }
  return out;
}
function primaryOf(keys, boneHit) {
  const found = foundFromKeys(keys);
  if (!found.size) return boneHit ? "shoulder_only" : "muscle";
  return [...found].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0];
}

/** [primary if it passed through, primary if a bow arrow stopped at bone (or null), notes]. */
export function classify(res, weapon = "Bow") {
  const notes = [];
  if (res.missed) return ["miss", null, notes];
  const bone = res.boneFirst !== null;
  const all = keysOf(res), before = keysOf(res, false);
  const primary = primaryOf(all, bone);
  let stopped = null;
  const bow = /^(bow|cross)/i.test(weapon);
  if (bow && bone && (before.size !== all.size || [...all].some((x) => !before.has(x)))) {
    stopped = primaryOf(before, bone);
    if (stopped === primary) stopped = null;
    else notes.push("The arrow path runs into the shoulder/leg bone. Bows often stop or deflect there — see both outcomes below. Check how much of the arrow penetrated.");
  }
  const found = foundFromKeys(all);
  if (found.has("paunch") && primary !== "paunch") notes.push("Stomach/intestines also hit — expect gut matter on the arrow and a stronger odor; if blood is sparse, treat it as a gut shot and wait longer.");
  if (found.has("liver") && (found.has("single_lung") || found.has("double_lung"))) notes.push("Lung + liver: usually fatal within an hour or two.");
  return [primary, stopped, notes];
}

export const EVIDENCE = {
  "(not checked yet)": null, "Bright red, pink, frothy blood with bubbles": "double_lung", "Bright red blood, no bubbles": null,
  "Dark red / maroon blood": "liver", "Green or brown matter, foul smell, greasy arrow": "paunch", "White tallow / fat, little blood": "muscle",
  "Very heavy bright-red spray": "heart", "No blood, arrow clean": "miss",
};
export const REACTION = {
  "(didn't see)": null, "Mule kick / bucked, then ran hard and low": "Typical of heart/lung hits.",
  "Hunched up, walked or trotted off slowly": "Typical of a gut (stomach/intestine) or liver hit — wait longer.",
  "Dropped on the spot": "Spine/CNS — be ready for a follow-up shot.", "Ran off normally with tail up": "Often a miss or a superficial hit — check carefully for sign.",
  "Leg buckled / limping": "Possible leg or shoulder bone hit — often non-lethal.",
};
/** Downward shot angle (deg) from stand height (ft) and horizontal distance (yd). */
export const standAngle = (heightFt, distYd) => (distYd <= 0 ? 0 : (Math.atan2(heightFt, distYd * 3) * 180) / Math.PI);

// ---------------------------------------------------------------- drawing helpers (vector, replaces shot_render.py)
export const VIEW = { xMin: -48, xMax: 48, yMin: -40, yMax: 40 };
/** Exact 2D outline of an ellipsoid projected on the (r, u) screen plane: [[x, y], ...]. */
export function outline(part, r, u, n = 48) {
  const a2 = part.semi.map((s) => s * s);
  const m11 = r[0] * r[0] * a2[0] + r[1] * r[1] * a2[1] + r[2] * r[2] * a2[2];
  const m12 = r[0] * u[0] * a2[0] + r[1] * u[1] * a2[1] + r[2] * u[2] * a2[2];
  const m22 = u[0] * u[0] * a2[0] + u[1] * u[1] * a2[1] + u[2] * u[2] * a2[2];
  const l11 = Math.sqrt(m11 + 1e-9), l21 = m12 / l11, l22 = Math.sqrt(Math.max(1e-9, m22 + 1e-9 - l21 * l21));
  const cx = dot(r, part.center), cy = dot(u, part.center);
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n, c = Math.cos(t), s = Math.sin(t); pts.push([cx + l11 * c, cy + l21 * c + l22 * s]); }
  return pts;
}
export const project = (p, r, u) => [dot(r, p), dot(u, p)];
export const depth = (part, d) => dot(part.center, d);
