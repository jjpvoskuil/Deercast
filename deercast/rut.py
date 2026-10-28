"""Peak breeding (rut) dates by state / region.

Each entry: (month, day, source label, url, confidence). The date is the *peak breeding* (mean conception)
date the model's season curve is centered on; hunter-visible seeking/chasing peaks ~1 week earlier.

Sources (checked 2026-10-27):
- KY: University of Kentucky Forestry Extension — "peak breeding … usually occurs in mid-November".
- TX: TPWD "The Rut in White-tailed Deer" — peak breeding dates by ecological region.
- AL: Alabama WFF (Director C. Sykes) — most of state late Jan–early Feb; north AL mid/late Dec–early Jan.
- MS: MDWFP mean-conception-date map — early Dec in NW (Delta) to Feb in SE.
- GA: Georgia DNR county rut map (deer-vehicle-collision peaks) — mostly late Oct–late Nov; SW corner December.
- FL / LA / SC: approximate, from agency maps' general patterns — check the agency map.
- All other states: regional average for the state (approximate). Override in the app if your agency publishes
  a different date for your area.
"""

from __future__ import annotations

from dataclasses import dataclass

UKY = "https://forestry.mgcafe.uky.edu/deer"
TPWD = "https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/"
ADCNR = "https://outdooralabama.com/node/2002"
MDWFP = "https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map"
GADNR = "https://georgiawildlife.com/rut-map"
LDWF = "https://www.wlf.louisiana.gov/page/deer-breeding-periods"
FWC = "https://myfwc.com/hunting/by-species/deer/"
SCDNR = "https://www.dnr.sc.gov/wildlife/deer/"


@dataclass(frozen=True)
class RutInfo:
    month: int
    day: int
    source: str
    url: str | None
    confidence: str  # "agency" | "approximate"
    region: str = ""


# Statewide regional averages (approximate) for states with fairly uniform November ruts.
_STATE_AVG = {
    "ME": (11, 10), "NH": (11, 13), "VT": (11, 12), "MA": (11, 15), "RI": (11, 20), "CT": (11, 18),
    "NY": (11, 13), "PA": (11, 16), "NJ": (11, 19), "DE": (11, 17), "MD": (11, 16), "WV": (11, 19),
    "VA": (11, 21), "NC": (11, 16), "MI": (11, 10), "WI": (11, 12), "MN": (11, 12), "OH": (11, 18),
    "IN": (11, 18), "IL": (11, 19), "IA": (11, 15), "MO": (11, 19), "TN": (11, 19), "AR": (11, 20),
    "ND": (11, 12), "SD": (11, 14), "NE": (11, 15), "KS": (11, 18), "OK": (11, 22), "MT": (11, 14),
    "WY": (11, 14), "CO": (11, 17), "ID": (11, 15), "WA": (11, 15), "OR": (11, 15), "CA": (11, 10),
    "NM": (12, 20), "AZ": (1, 5),
}


def peak_for(state: str | None, lat: float, lon: float) -> RutInfo:
    """Best available peak-breeding date for a location."""
    st = (state or "").upper()
    if st == "KY":
        return RutInfo(11, 15, "University of Kentucky Forestry Extension (mid-November)", UKY, "agency")
    if st == "TX":
        if lat < 28.8:
            return RutInfo(12, 20, "TPWD — South Texas Plains", TPWD, "agency", "South Texas")
        if lon < -103.0:
            return RutInfo(12, 8, "TPWD — Trans-Pecos", TPWD, "agency", "Trans-Pecos")
        if lon < -100.5 and lat < 31.5:
            return RutInfo(12, 5, "TPWD — western Edwards Plateau", TPWD, "agency", "W. Edwards Plateau")
        if lat >= 33.0 and lon < -98.5:
            return RutInfo(12, 3, "TPWD — northern Rolling Plains", TPWD, "agency", "Rolling Plains")
        if lon > -95.7:
            return RutInfo(11, 17, "TPWD — Pineywoods / Post Oak Savannah", TPWD, "agency", "East Texas")
        if lat < 30.0 and lon > -97.5:
            return RutInfo(10, 31, "TPWD — Gulf Prairies (southern)", TPWD, "agency", "Gulf Prairies")
        return RutInfo(11, 22, "TPWD — Edwards Plateau / Cross Timbers", TPWD, "agency", "Central Texas")
    if st == "AL":
        if lat >= 33.6:
            return RutInfo(12, 30, "Alabama WFF — north Alabama (mid-Dec to early Jan)", ADCNR, "agency",
                           "North Alabama")
        return RutInfo(1, 28, "Alabama WFF — most of state (late Jan–early Feb)", ADCNR, "agency",
                       "Central/South Alabama")
    if st == "MS":
        if lat >= 32.5 and lon < -90.2:
            return RutInfo(12, 10, "MDWFP conception map — Delta / northwest", MDWFP, "agency", "Delta")
        if lat < 31.8 and lon > -89.8:
            return RutInfo(2, 1, "MDWFP conception map — southeast", MDWFP, "agency", "Southeast MS")
        return RutInfo(1, 5, "MDWFP conception map — central (approx.)", MDWFP, "approximate", "Central MS")
    if st == "GA":
        if lat < 31.3 and lon < -83.8:
            return RutInfo(12, 12, "Georgia DNR rut map — southwest", GADNR, "agency", "Southwest GA")
        if lat >= 34.5:
            return RutInfo(11, 20, "Georgia DNR rut map — mountains", GADNR, "agency", "North GA")
        return RutInfo(11, 8, "Georgia DNR rut map — most of state", GADNR, "agency", "Piedmont/Coastal")
    if st == "FL":
        if lon < -84.6:
            return RutInfo(1, 25, "FWC pattern — Panhandle (approx.)", FWC, "approximate", "Panhandle")
        if lat < 27.0:
            return RutInfo(8, 15, "FWC pattern — south Florida (approx.)", FWC, "approximate", "South FL")
        if lat < 28.8:
            return RutInfo(10, 15, "FWC pattern — central Florida (approx.)", FWC, "approximate", "Central FL")
        return RutInfo(12, 1, "FWC pattern — north Florida (approx.)", FWC, "approximate", "North FL")
    if st == "LA":
        if lon > -91.2 and lat < 31.0:
            return RutInfo(1, 15, "LDWF breeding map — Florida Parishes/SE (approx.)", LDWF, "approximate",
                           "Southeast LA")
        if lat >= 31.5:
            return RutInfo(11, 28, "LDWF breeding map — north (approx.)", LDWF, "approximate", "North LA")
        return RutInfo(10, 30, "LDWF breeding map — southwest (approx.)", LDWF, "approximate", "Southwest LA")
    if st == "SC":
        return RutInfo(11, 1, "SCDNR — statewide early rut (approx.)", SCDNR, "approximate")
    if st in _STATE_AVG:
        m, d = _STATE_AVG[st]
        return RutInfo(m, d, "Regional average for the state (approx.)", None, "approximate")
    # unknown state → latitude rule
    if lat >= 40:
        m, d = 11, 10
    elif lat >= 36:
        m, d = 11, 15
    elif lat >= 33:
        m, d = 11, 22
    else:
        m, d = 12, 15
    return RutInfo(m, d, "Latitude estimate (no state data)", None, "approximate")
