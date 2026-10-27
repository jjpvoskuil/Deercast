"""Kentucky deer regulations — 2026-27 season.

Sources (verified 2026-10-27):
- KDFWR Deer page: https://fw.ky.gov/Hunt/Pages/Deer.aspx (season dates, bag limits, orange, hours, telecheck)
- 301 KAR 2:172 (zone county lists, as amended eff. 2/22/2024) + KDFWR 2025-2026 Deer Report
  (zone reassignments effective 2026-27): https://fw.ky.gov/Hunt/Documents/2025-2026-Deer-Report.pdf
- KDFWR CWD Surveillance Zone page: https://fw.ky.gov/Wildlife/Pages/CWD-SurveillanceZone.aspx

UPDATE EVERY SEASON (typically after the KDFWR guide is published in summer).
"""

from datetime import date

SEASON = "2026-27"
VERIFIED = date(2026, 10, 27)
STATE = "Kentucky"
AGENCY = "Kentucky Department of Fish & Wildlife Resources (KDFWR)"

LINKS = {
    "KDFWR deer hunting page": "https://fw.ky.gov/Hunt/Pages/Deer.aspx",
    "Hunting & Trapping Guide (PDF)": "https://fw.ky.gov/Hunt/Documents/HuntingGuideEntire.pdf",
    "Deer zone map": "https://fw.ky.gov/Hunt/PublishingImages/DeerZonesMap.png",
    "CWD Surveillance Zone": "https://fw.ky.gov/Wildlife/Pages/CWD-SurveillanceZone.aspx",
    "Season dates (all species)": "https://app.fw.ky.gov/SeasonDates/Default.aspx",
}

# (name, start, end, note)
SEASONS = [
    ("Archery", date(2026, 9, 5), date(2027, 1, 18), "Statewide"),
    ("Crossbow", date(2026, 9, 19), date(2027, 1, 18), "Statewide"),
    ("CWD antlerless (firearm)", date(2026, 9, 25), date(2026, 9, 28), "CWD Surveillance Zone counties in Deer Zones 1–3 only"),
    ("Youth-only gun", date(2026, 10, 10), date(2026, 10, 18), "Youth hunters"),
    ("Muzzleloader – early", date(2026, 10, 17), date(2026, 10, 18), "Statewide"),
    ("Modern gun", date(2026, 11, 14), date(2026, 11, 29), "All zones"),
    ("Muzzleloader – late", date(2026, 12, 12), date(2026, 12, 20), "Statewide"),
    ("Free youth weekend", date(2026, 12, 26), date(2026, 12, 27), "Youth hunters"),
]

# Base: 301 KAR 2:172 (2024). 2025-26 had no zone changes.
_BASE = {
    1: "Anderson Ballard Boone Bracken Bullitt Caldwell Calloway Campbell Carlisle Carroll Christian Crittenden "
       "Franklin Fulton Gallatin Grant Graves Green Hardin Harrison Hart Henderson Henry Hickman Hopkins Jefferson "
       "Kenton Larue Livingston Lyon Marshall Mason McLean McCracken Mercer Muhlenberg Nelson Oldham Owen Pendleton "
       "Robertson Scott Shelby Spencer Todd Trigg Trimble Union Washington Webster Woodford",
    2: "Adair Allen Barren Bath Bourbon Boyd Boyle Breckinridge Butler Carter Casey Clark Daviess Edmonson Fayette "
       "Fleming Grayson Greenup Hancock Jessamine Lawrence Lewis Lincoln Logan Madison Marion Meade Metcalfe Monroe "
       "Montgomery Nicholas Ohio Simpson Taylor Warren",
    3: "Cumberland Elliott Estill Garrard Johnson Laurel Morgan Powell Pulaski Rowan Wayne Wolfe",
    4: "Bell Breathitt Clay Clinton Floyd Harlan Jackson Knott Knox Lee Leslie Letcher Magoffin Martin McCreary "
       "Menifee Owsley Perry Pike Rockcastle Russell Whitley",
}
# 2026-27 reassignments (KDFWR 2025-2026 Deer Report)
_CHANGES_2026 = {
    1: "Adair Boyd Breckinridge Butler Carter Daviess Grayson Greenup Hancock Lawrence Lewis Logan Marion Meade "
       "Metcalfe Ohio Taylor",
    2: "Cumberland Elliott Garrard Johnson Morgan Rowan",
    3: "Clinton Jackson Martin Menifee Pike Rockcastle Russell",
}

ZONES: dict[str, int] = {}
for z, names in _BASE.items():
    for n in names.split():
        ZONES[n] = z
for z, names in _CHANGES_2026.items():
    for n in names.split():
        ZONES[n] = z

ZONE_BAG = {
    1: "Unlimited antlerless deer (statewide permit + additional deer permits).",
    2: "No more than 4 deer total.",
    3: "No more than 4 deer total; only 1 antlerless deer may be taken with a firearm or air gun.",
    4: "No more than 2 deer, only 1 of which may be antlerless. No antlerless deer during modern gun, early "
       "muzzleloader, or the first 6 days of late muzzleloader season.",
}

STATEWIDE = [
    ("Antlered limit", "1 antlered deer per hunter statewide, regardless of zone, method or season."),
    ("Statewide / youth deer permit", "4 deer: 1 antlered + 3 antlerless, or 4 antlerless. Additional deer permit: up to 2 more."),
    ("Legal shooting hours", "30 minutes before sunrise to 30 minutes after sunset."),
    ("Hunter orange", "Required during modern gun, muzzleloader and youth firearm deer seasons (and firearm elk/bear): "
     "solid, unbroken orange visible from all sides on head, back and chest. Archery/crossbow hunters must wear it "
     "during firearm deer seasons too (except WMAs closed to firearm deer/elk hunting)."),
    ("Telecheck", "Fill out harvest log immediately; telecheck by midnight the day of harvest/recovery — "
     "1-800-245-4263 or online (My Profile). Carcass tag required if the deer leaves your possession."),
]

CWD_COUNTIES = set(
    "Ballard Breckinridge Calloway Carlisle Casey Fulton Graves Hardin Henderson Hickman Laurel Lincoln Marshall "
    "McCracken McCreary Meade Pulaski Rockcastle Russell Union Wayne Webster Whitley".split()
)
CWD_RULES = [
    "Baiting allowed with restrictions for 2026-27; contact-style feeders (troughs, funnels, gravity feeders) prohibited. "
    "No baiting on WMAs/public land.",
    "Mandatory CWD sampling applies to all hunters (including license-exempt). Telecheck first. Testing is free; results ~4–6 weeks.",
    "Only deboned meat, antlers/clean skull cap, clean skull, teeth, hides and finished mounts may leave the zone.",
    "CWD antlerless season Sept 25–28, 2026 (zone counties in Deer Zones 1–3): drop the head at a CWD drop-off site.",
    "Nov 14–16, 2026: deer from Henderson, McCreary, Pulaski and Wayne counties must go to a staffed check station.",
]


def normalize_county(name: str | None) -> str | None:
    if not name:
        return None
    n = name.replace(" County", "").strip()
    fixes = {"Mcclean": "McLean", "Mclean": "McLean", "Mccracken": "McCracken", "Mccreary": "McCreary", "Larue": "Larue",
             "LaRue": "Larue", "Metcalf": "Metcalfe"}
    n = n[:1].upper() + n[1:]
    return fixes.get(n, n)


def zone_for(county: str | None) -> int | None:
    return ZONES.get(normalize_county(county) or "")
