// Peak breeding (rut) dates by state/region — JavaScript copy of deercast/rut.py (keep in step; parity test).
export const SOURCES = {
  UKY: "https://forestry.mgcafe.uky.edu/deer", TPWD: "https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/",
  ADCNR: "https://outdooralabama.com/node/2002", MDWFP: "https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map",
  GADNR: "https://georgiawildlife.com/rut-map", LDWF: "https://www.wlf.louisiana.gov/page/deer-breeding-periods",
  FWC: "https://myfwc.com/hunting/by-species/deer/", SCDNR: "https://www.dnr.sc.gov/wildlife/deer/",
};
const S = SOURCES;
const STATE_AVG = {
  ME: [11, 10], NH: [11, 13], VT: [11, 12], MA: [11, 15], RI: [11, 20], CT: [11, 18], NY: [11, 13], PA: [11, 16],
  NJ: [11, 19], DE: [11, 17], MD: [11, 16], WV: [11, 19], VA: [11, 21], NC: [11, 16], MI: [11, 10], WI: [11, 12],
  MN: [11, 12], OH: [11, 18], IN: [11, 18], IL: [11, 19], IA: [11, 15], MO: [11, 19], TN: [11, 19], AR: [11, 20],
  ND: [11, 12], SD: [11, 14], NE: [11, 15], KS: [11, 18], OK: [11, 22], MT: [11, 14], WY: [11, 14], CO: [11, 17],
  ID: [11, 15], WA: [11, 15], OR: [11, 15], CA: [11, 10], NM: [12, 20], AZ: [1, 5],
};
const R = (month, day, source, url, confidence, region = "") => ({ month, day, source, url, confidence, region });

export function peakFor(state, lat, lon) {
  const st = (state || "").toUpperCase();
  if (st === "KY") return R(11, 15, "University of Kentucky Forestry Extension (mid-November)", S.UKY, "agency");
  if (st === "TX") {
    if (lat < 28.8) return R(12, 20, "TPWD — South Texas Plains", S.TPWD, "agency", "South Texas");
    if (lon < -103.0) return R(12, 8, "TPWD — Trans-Pecos", S.TPWD, "agency", "Trans-Pecos");
    if (lon < -100.5 && lat < 31.5) return R(12, 5, "TPWD — western Edwards Plateau", S.TPWD, "agency", "W. Edwards Plateau");
    if (lat >= 33.0 && lon < -98.5) return R(12, 3, "TPWD — northern Rolling Plains", S.TPWD, "agency", "Rolling Plains");
    if (lon > -95.7) return R(11, 17, "TPWD — Pineywoods / Post Oak Savannah", S.TPWD, "agency", "East Texas");
    if (lat < 30.0 && lon > -97.5) return R(10, 31, "TPWD — Gulf Prairies (southern)", S.TPWD, "agency", "Gulf Prairies");
    return R(11, 22, "TPWD — Edwards Plateau / Cross Timbers", S.TPWD, "agency", "Central Texas");
  }
  if (st === "AL") return lat >= 33.6
    ? R(12, 30, "Alabama WFF — north Alabama (mid-Dec to early Jan)", S.ADCNR, "agency", "North Alabama")
    : R(1, 28, "Alabama WFF — most of state (late Jan–early Feb)", S.ADCNR, "agency", "Central/South Alabama");
  if (st === "MS") {
    if (lat >= 32.5 && lon < -90.2) return R(12, 10, "MDWFP conception map — Delta / northwest", S.MDWFP, "agency", "Delta");
    if (lat < 31.8 && lon > -89.8) return R(2, 1, "MDWFP conception map — southeast", S.MDWFP, "agency", "Southeast MS");
    return R(1, 5, "MDWFP conception map — central (approx.)", S.MDWFP, "approximate", "Central MS");
  }
  if (st === "GA") {
    if (lat < 31.3 && lon < -83.8) return R(12, 12, "Georgia DNR rut map — southwest", S.GADNR, "agency", "Southwest GA");
    if (lat >= 34.5) return R(11, 20, "Georgia DNR rut map — mountains", S.GADNR, "agency", "North GA");
    return R(11, 8, "Georgia DNR rut map — most of state", S.GADNR, "agency", "Piedmont/Coastal");
  }
  if (st === "FL") {
    if (lon < -84.6) return R(1, 25, "FWC pattern — Panhandle (approx.)", S.FWC, "approximate", "Panhandle");
    if (lat < 27.0) return R(8, 15, "FWC pattern — south Florida (approx.)", S.FWC, "approximate", "South FL");
    if (lat < 28.8) return R(10, 15, "FWC pattern — central Florida (approx.)", S.FWC, "approximate", "Central FL");
    return R(12, 1, "FWC pattern — north Florida (approx.)", S.FWC, "approximate", "North FL");
  }
  if (st === "LA") {
    if (lon > -91.2 && lat < 31.0) return R(1, 15, "LDWF breeding map — Florida Parishes/SE (approx.)", S.LDWF, "approximate", "Southeast LA");
    if (lat >= 31.5) return R(11, 28, "LDWF breeding map — north (approx.)", S.LDWF, "approximate", "North LA");
    return R(10, 30, "LDWF breeding map — southwest (approx.)", S.LDWF, "approximate", "Southwest LA");
  }
  if (st === "SC") return R(11, 1, "SCDNR — statewide early rut (approx.)", S.SCDNR, "approximate");
  if (STATE_AVG[st]) return R(...STATE_AVG[st], "Regional average for the state (approx.)", null, "approximate");
  const [m, d] = lat >= 40 ? [11, 10] : lat >= 36 ? [11, 15] : lat >= 33 ? [11, 22] : [12, 15];
  return R(m, d, "Latitude estimate (no state data)", null, "approximate");
}

/** Hunting season of a 'YYYY-MM-DD': Jul–Dec → that year, Jan–Jun → previous year. */
export const seasonYear = (key) => { const [y, m] = key.split("-").map(Number); return m >= 7 ? y : y - 1; };
const pad = (n) => String(n).padStart(2, "0");
/** Peak breeding date ('YYYY-MM-DD') for the season containing `key`. override = 'MM-DD' or null. */
export function rutPeakFor(key, lat, lon, state, override = null) {
  const yr = seasonYear(key);
  let m, d;
  if (override) [m, d] = override.split("-").map(Number);
  else ({ month: m, day: d } = peakFor(state, lat, lon));
  return `${m >= 7 ? yr : yr + 1}-${pad(m)}-${pad(d)}`;
}
