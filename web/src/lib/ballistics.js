// Firearm ballistics for the Gun setup page: a point-mass trajectory with the standard G1 drag model
// (the model behind published "G1 BC" numbers), standard sea-level air, no wind. Good to a few % against
// published tables out to normal deer ranges — always confirm on paper at the range.

// G1 drag coefficient vs Mach (standard table).
const G1 = [
  [0, .2629], [.05, .2558], [.1, .2487], [.15, .2413], [.2, .2344], [.25, .2278], [.3, .2214], [.35, .2155], [.4, .2104], [.45, .2061],
  [.5, .2032], [.55, .2020], [.6, .2034], [.7, .2165], [.725, .2230], [.75, .2313], [.775, .2417], [.8, .2546], [.825, .2706], [.85, .2901],
  [.875, .3136], [.9, .3415], [.925, .3734], [.95, .4084], [.975, .4448], [1, .4805], [1.025, .5136], [1.05, .5427], [1.075, .5677], [1.1, .5883],
  [1.125, .6053], [1.15, .6191], [1.2, .6393], [1.25, .6518], [1.3, .6589], [1.35, .6621], [1.4, .6625], [1.45, .6607], [1.5, .6573], [1.55, .6528],
  [1.6, .6474], [1.65, .6413], [1.7, .6347], [1.75, .6280], [1.8, .6210], [1.85, .6141], [1.9, .6072], [1.95, .6003], [2, .5934], [2.05, .5867],
  [2.1, .5804], [2.15, .5743], [2.2, .5685], [2.25, .5630], [2.3, .5577], [2.35, .5527], [2.4, .5481], [2.45, .5438], [2.5, .5397], [2.6, .5325],
  [2.7, .5264], [2.8, .5211], [2.9, .5168], [3, .5133], [3.1, .5105], [3.2, .5084], [3.3, .5067], [3.4, .5054], [3.5, .5040], [3.6, .5030],
  [3.7, .5022], [3.8, .5016], [3.9, .5010], [4, .5006], [4.2, .4998], [4.4, .4995], [4.6, .4992], [4.8, .4990], [5, .4988],
];
const cdG1 = (m) => {
  if (m <= 0) return G1[0][1];
  for (let i = 1; i < G1.length; i++) if (m <= G1[i][0]) { const [a, ca] = G1[i - 1], [b, cb] = G1[i]; return ca + ((cb - ca) * (m - a)) / (b - a); }
  return G1[G1.length - 1][1];
};

const FT = 0.3048, YD = 0.9144, IN = 0.0254, G = 9.80665, RHO = 1.225, SOUND = 340.29;
const IN2_PER_LB = 0.00064516 / 0.45359237; // in²/lb → m²/kg

export const GUN_TYPES = ["Rifle", "Shotgun slug", "Muzzleloader", "Handgun"];
export const BULLET_TYPES = ["Bonded / controlled expansion", "Soft point (cup & core)", "Polymer tip (ballistic tip)", "Monolithic copper",
  "Full-bore slug (Foster)", "Sabot slug", "Sabot bullet (muzzleloader)", "Conical / Maxi-ball", "Round ball"];
/** A usable G1 BC when you don't know yours. */
export const DEFAULT_BC = { "Rifle": 0.4, "Shotgun slug": 0.12, "Muzzleloader": 0.2, "Handgun": 0.15 };
export const energy = (gr, fps) => (gr * fps * fps) / 450436;          // ft·lb
export const DEER_FTLB = 1000;                                           // common minimum at impact for deer
export const DEER_FTLB_MIN = 800;                                        // widely quoted floor (slugs / muzzleloaders up close)

/** Path relative to the line of sight for a given bore angle. Returns rows [{yd, fps, ftlb, dropIn, tof}]. */
function fly(s, angle, stops) {
  const bc = s.bc > 0 ? s.bc : DEFAULT_BC[s.type] || 0.3;
  const k = 0.5 * RHO * (Math.PI / 4) * IN2_PER_LB / bc;
  const h = (s.sight_in ?? 1.5) * IN;
  let x = 0, y = -h, vx = s.fps * FT * Math.cos(angle), vy = s.fps * FT * Math.sin(angle), t = 0;
  const out = []; let i = 0; const dt = 0.0005;
  while (i < stops.length && t < 5) {
    const v = Math.hypot(vx, vy), a = k * cdG1(v / SOUND) * v;
    const nx = x + vx * dt, ny = y + vy * dt; // (used only to interpolate the crossing)
    const target = stops[i] * YD;
    if (nx >= target) {
      const f = (target - x) / (nx - x), yy = y + (ny - y) * f, fps = v / FT;
      out.push({ yd: stops[i], fps, ftlb: energy(s.gr, fps), dropIn: yy / IN, tof: t + dt * f });
      i++; continue;
    }
    // midpoint (RK2) step
    const hx = vx - a * vx * dt / 2, hy = vy - (a * vy + G) * dt / 2, hv = Math.hypot(hx, hy), ha = k * cdG1(hv / SOUND) * hv;
    x += hx * dt; y += hy * dt; vx -= ha * hx * dt; vy -= (ha * hy + G) * dt; t += dt;
  }
  return out;
}

/** Ballistics table for a gun setup {type, gr, fps, bc, zero_yd, sight_in}. null if speed/weight missing. */
export function gunTable(s, stops = [25, 50, 100, 150, 200, 250, 300]) {
  if (!(s?.fps > 0) || !(s?.gr > 0)) return null;
  const zero = s.zero_yd > 0 ? s.zero_yd : 100;
  // bore angle that puts the bullet on the line of sight at the zero distance
  let lo = -0.01, hi = 0.05;
  for (let n = 0; n < 50; n++) { const mid = (lo + hi) / 2, r = fly(s, mid, [zero])[0]; if (!r || r.dropIn < 0) lo = mid; else hi = mid; }
  const rows = fly(s, (lo + hi) / 2, [...new Set([...stops, zero])].sort((a, b) => a - b));
  const maxYd = rows.filter((r) => r.ftlb >= DEER_FTLB).reduce((m, r) => Math.max(m, r.yd), 0);
  return { rows, muzzleFtlb: energy(s.gr, s.fps), zero, maxDeerYd: maxYd };
}

/** At one distance (for the Shot page): {fps, ftlb, dropIn}. */
export function atRange(s, yd) {
  const t = gunTable(s, [Math.max(1, Math.round(yd))]);
  return t ? t.rows.find((r) => r.yd === Math.max(1, Math.round(yd))) : null;
}
