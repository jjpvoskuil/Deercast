// Bow / crossbow setup math — JavaScript copy of deercast/archery.py (parity test: archery.test.js).
export const TIP_FACTOR = { "Fixed-blade broadhead": 1.0, "Hybrid broadhead": 0.85, "Mechanical / expandable broadhead": 0.72, "Field point / target": 0.9 };
export const BOW_TYPES = ["Compound", "Crossbow", "Recurve / longbow"];

/** Estimated arrow speed (fps), or the chronograph speed if entered. */
export function estimateSpeed(s) {
  if (s.chrono_fps) return +s.chrono_fps;
  const kind = s.bow_type || "Compound", aw = +s.arrow_gr || 0;
  if (aw <= 0) return null;
  if (kind === "Crossbow") { const vr = +s.rated_fps || 0, mr = +s.rated_bolt_gr || 400; return vr ? vr * Math.sqrt(mr / aw) : null; }
  const dw = +s.draw_weight || 0;
  if (kind === "Compound") {
    const ibo = +s.rated_fps || 0;
    if (!ibo || !dw) return null;
    const dl = +(s.draw_length || 30);
    let v = ibo - 10 * (30 - dl) - Math.max(0, aw - 5 * dw) / 3 - (+s.string_gr || 0) / 3;
    v -= Math.max(0, 70 - dw) * 1.7;
    return Math.max(v, 120);
  }
  if (!dw) return null;
  return Math.max(110, 120 + 1.25 * dw - Math.max(0, aw - 9 * dw) / 6);
}
export const kineticEnergy = (gr, fps) => (gr * fps * fps) / 450800;
export const momentum = (gr, fps) => (gr * fps) / 225218;
export const keClass = (ke) => (ke < 25 ? "Small game only" : ke < 42 ? "Adequate for deer" : ke < 65 ? "Deer, black bear, elk" : "Any North American game");
export function boneRating(s) {
  const v = estimateSpeed(s);
  if (!v) return ["Unknown", 0];
  const m = momentum(+s.arrow_gr, v) * (TIP_FACTOR[s.tip_type] ?? 0.85);
  return [m >= 0.52 ? "High" : m >= 0.40 ? "Moderate" : "Low", m];
}
export function summary(s) {
  const v = estimateSpeed(s);
  if (!v) return null;
  const gr = +s.arrow_gr, ke = kineticEnergy(gr, v), mo = momentum(gr, v), [bone, eff] = boneRating(s);
  return { fps: v, ke, momentum: mo, keClass: keClass(ke), bone, effMomentum: eff, gpp: s.draw_weight ? gr / +s.draw_weight : null, measured: !!s.chrono_fps };
}
/** Seconds to target, with ~1.5% speed loss per 10 yd. */
/** Front-of-center %: how far the balance point sits ahead of the arrow's middle (AMO/ATA method).
 *  length = nock throat to end of shaft (no point), balance = nock throat to balance point with the tip on. */
export function foc(length, balance) {
  if (!(length > 0) || !(balance > 0) || balance >= length) return null;
  return ((balance - length / 2) / length) * 100;
}
export const focClass = (p) => (p == null ? "" : p < 7 ? "Low" : p < 10 ? "Target range" : p <= 15 ? "Good for hunting" : p < 19 ? "High FOC" : "Extreme FOC (19%+)");
export const flightTime = (fps, yards) => (fps <= 0 ? NaN : (yards * 3) / (fps * (1 - (0.0075 * yards) / 10)));
