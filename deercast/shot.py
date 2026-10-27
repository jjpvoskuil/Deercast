"""Shot analysis: simplified 3D whitetail anatomy, arrow-path ray casting, and outcome estimates.

Coordinates (inches), deer body frame for an average adult whitetail (~150 lb):
    x = forward (toward head), y = deer's LEFT side, z = up. Origin = center of the torso.
Every part is an axis-aligned ellipsoid (center, semi-axes). This is a teaching/estimation
model — real anatomy varies with size, posture and leg position.

Shooter geometry:
    yaw   = deer's angle to the shooter. 0 = broadside, +45 = quartering away, -45 = quartering
            toward, +90 = straight away, -90 = facing you.
    pitch = downward shot angle (degrees) — e.g. from a tree stand.
    side  = which side of the deer faced the shooter ("left" or "right").
The model is built for the deer's LEFT side facing the shooter; a right-side shot mirrors y.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class Part:
    key: str
    label: str
    center: tuple
    semi: tuple
    kind: str  # body | organ | bone
    color: str = "#999999"


# ---- exterior (used for silhouette + entry/exit) ----
BODY = [
    Part("torso", "Torso", (0, 0, 0), (20, 8, 10), "body", "#a87a4f"),
    Part("ham_l", "Left ham", (-16, 4.5, -3), (7.5, 3.8, 10), "body", "#9c6f45"),
    Part("ham_r", "Right ham", (-16, -4.5, -3), (7.5, 3.8, 10), "body", "#8d6440"),
    Part("neck_base", "Neck (base)", (17, 0, 4), (7, 5.5, 8), "body", "#a87a4f"),
    Part("neck", "Neck", (25, 0, 11), (7.5, 4, 5), "body", "#a87a4f"),
    Part("head", "Head", (34, 0, 17.5), (6.5, 3.4, 3.8), "body", "#9c6f45"),
    Part("upper_fl", "Front upper leg (L)", (14, 4.6, -8), (4.2, 2.8, 8), "body", "#9c6f45"),
    Part("upper_fr", "Front upper leg (R)", (14, -4.6, -8), (4.2, 2.8, 8), "body", "#8d6440"),
    Part("leg_fl", "Front leg (L)", (14, 4, -22), (1.8, 1.7, 14), "body", "#7e5a3a"),
    Part("leg_fr", "Front leg (R)", (14, -4, -22), (1.8, 1.7, 14), "body", "#6e4f33"),
    Part("leg_rl", "Hind leg (L)", (-18, 4, -22), (2.1, 1.9, 14), "body", "#7e5a3a"),
    Part("leg_rr", "Hind leg (R)", (-18, -4, -22), (2.1, 1.9, 14), "body", "#6e4f33"),
]

# ---- internal ----
ORGANS = [
    Part("brain", "Brain", (35.5, 0, 19), (2.5, 1.8, 1.8), "organ", "#f0c0d0"),
    Part("spine", "Spine", (2, 0, 8.6), (24, 1.1, 1.1), "bone", "#f2efe6"),
    Part("neck_spine", "Neck spine", (23, 0, 12), (9, 1.1, 1.1), "bone", "#f2efe6"),
    Part("neck_vessels", "Windpipe / carotid / jugular", (23, 0, 8), (9, 1.6, 1.6), "organ", "#d0505a"),
    Part("aorta", "Aorta & major vessels", (4, 0, 6.6), (15, 1.0, 1.0), "organ", "#c0202a"),
    Part("heart", "Heart", (12.5, 0, -4.5), (3, 2.4, 3.2), "organ", "#d7261e"),
    Part("lung_l", "Left lung", (9, 3.2, 1.5), (7.5, 3.2, 6), "organ", "#f08a96"),
    Part("lung_r", "Right lung", (9, -3.2, 1.5), (7.5, 3.2, 6), "organ", "#f08a96"),
    Part("liver", "Liver", (-0.5, -1.5, -0.5), (3.2, 5.5, 6.5), "organ", "#7a1f2b"),
    Part("kidneys", "Kidneys", (-7.5, 0, 6), (2, 4.2, 1.8), "organ", "#9a3b3b"),
    Part("rumen", "Stomach (rumen)", (-8, 2, -2), (8, 5.5, 6.5), "organ", "#7f9a52"),
    Part("intestines", "Intestines", (-11, -2.5, -4.5), (5.5, 4.5, 4.5), "organ", "#a8a060"),
    Part("femoral_l", "Femoral artery (L)", (-16, 4.5, -8), (2, 1.2, 4), "organ", "#c0202a"),
    Part("femoral_r", "Femoral artery (R)", (-16, -4.5, -8), (2, 1.2, 4), "organ", "#c0202a"),
    Part("shoulder_l", "Shoulder blade / leg bone (L)", (13.5, 6.4, -1), (5, 1.5, 7.5), "bone", "#e8e2d0"),
    Part("shoulder_r", "Shoulder blade / leg bone (R)", (13.5, -6.4, -1), (5, 1.5, 7.5), "bone", "#e8e2d0"),
]

ALL = BODY + ORGANS
BY_KEY = {p.key: p for p in ALL}


# ---------------------------------------------------------------- geometry


def view_basis(yaw_deg: float, pitch_deg: float):
    """Unit vectors (d, r, u): arrow direction, screen-right, screen-up — in the left-side model frame."""
    th, ph = math.radians(yaw_deg), math.radians(pitch_deg)
    d = np.array([math.sin(th) * math.cos(ph), -math.cos(th) * math.cos(ph), -math.sin(ph)])
    r = np.cross(d, [0, 0, 1.0])
    if np.linalg.norm(r) < 1e-6:  # straight down
        r = np.array([-1.0, 0, 0])
    r /= np.linalg.norm(r)
    u = np.cross(r, d)
    u /= np.linalg.norm(u)
    return d, r, u


def ray_interval(p0, d, part: Part):
    """(t_in, t_out) where the ray p0 + t·d is inside the ellipsoid, or None."""
    c, a = np.asarray(part.center, float), np.asarray(part.semi, float)
    o = (p0 - c) / a
    v = d / a
    A, B, C = v @ v, 2 * (o @ v), o @ o - 1
    disc = B * B - 4 * A * C
    if disc <= 0:
        return None
    s = math.sqrt(disc)
    return ((-B - s) / (2 * A), (-B + s) / (2 * A))


@dataclass
class Hit:
    key: str
    label: str
    kind: str
    t_in: float
    t_out: float
    after_bone: bool = False

    @property
    def length(self):
        return self.t_out - self.t_in


@dataclass
class ShotResult:
    entry: np.ndarray | None
    exit: np.ndarray | None
    hits: list = field(default_factory=list)
    bone_first: Hit | None = None
    body_parts: list = field(default_factory=list)

    @property
    def missed(self):
        return self.entry is None

    def keys(self, include_after_bone=True):
        return {h.key for h in self.hits if include_after_bone or not h.after_bone}


def trace(sx: float, sy: float, yaw: float, pitch: float) -> ShotResult:
    """Trace the arrow through the body from screen point (sx, sy) in the shooter's view."""
    d, r, u = view_basis(yaw, pitch)
    p0 = sx * r + sy * u - 200 * d
    # body intervals → first contiguous cluster = where the arrow travels through the deer
    ivs = []
    for p in BODY:
        iv = ray_interval(p0, d, p)
        if iv:
            ivs.append((iv[0], iv[1], p.key))
    if not ivs:
        return ShotResult(None, None)
    ivs.sort()
    t_entry, t_exit = ivs[0][0], ivs[0][1]
    parts = [ivs[0][2]]
    for a, b, k in ivs[1:]:
        if a <= t_exit + 1.0:  # overlapping / touching parts
            t_exit = max(t_exit, b)
            parts.append(k)
        else:
            break
    res = ShotResult(p0 + t_entry * d, p0 + t_exit * d, body_parts=parts)
    for p in ORGANS:
        iv = ray_interval(p0, d, p)
        if not iv:
            continue
        a, b = max(iv[0], t_entry), min(iv[1], t_exit)
        if b - a > 0.15:
            res.hits.append(Hit(p.key, p.label, p.kind, a, b))
    res.hits.sort(key=lambda h: h.t_in)
    bones = [h for h in res.hits if h.key.startswith("shoulder")]
    if bones:
        res.bone_first = bones[0]
        for h in res.hits:
            h.after_bone = h is not bones[0] and h.t_in > bones[0].t_in
    return res


# ---------------------------------------------------------------- outcomes

# Typical outcomes compiled from hunter-education and bowhunting recovery guidance
# (state agency hunter-ed material, Bowhunter Education, QDMA/NDA tracking articles).
# Ranges are generalizations — individual deer vary a lot.
OUTCOMES = {
    "brain": dict(
        title="Brain / CNS", lethal=True, time="Instant", wait_min=0, yards=(0, 5, 20),
        blood="Little blood needed — deer drops on the spot.",
        tips=["Approach carefully from behind; be ready for a follow-up shot if the deer moves."],
    ),
    "spine": dict(
        title="Spine", lethal=True, time="Drops immediately (may be alive & paralyzed)", wait_min=0, yards=(0, 5, 20),
        blood="Often minimal; deer goes down in its tracks.",
        tips=["Deer may be paralyzed but alive — make an immediate, safe follow-up shot.",
              "A high back shot that only nicks the spine can stun the deer; it may get back up and run."],
    ),
    "heart": dict(
        title="Heart", lethal=True, time="Seconds to ~1 minute", wait_min=30, yards=(20, 60, 120),
        blood="Heavy blood, often starting a few yards after the shot; may be dark-to-bright red. "
              "Classic 'mule kick' reaction, then a hard, low run.",
        tips=["Wait ~30 minutes, then track. Expect a short, heavy trail.",
              "Blood may be sparse for the first 10–30 yd until the chest cavity fills."],
    ),
    "aorta": dict(
        title="Aorta / major vessels", lethal=True, time="Under 1 minute", wait_min=30, yards=(20, 60, 120),
        blood="Heavy bright-red blood.",
        tips=["Wait ~30 minutes. Trail should be obvious and short."],
    ),
    "double_lung": dict(
        title="Double lung", lethal=True, time="~10 seconds to 1–2 minutes", wait_min=30, yards=(30, 80, 150),
        blood="Bright red, pinkish and frothy with bubbles; may be sprayed on both sides of the trail. "
              "Deer often kicks or bolts hard, then slows.",
        tips=["Wait 30 minutes, then track quietly.",
              "Look for blood on brush at chest height as well as on the ground."],
    ),
    "femoral": dict(
        title="Femoral artery (hindquarter)", lethal=True, time="1–3 minutes if the artery is cut", wait_min=30,
        yards=(40, 100, 200),
        blood="Very heavy, bright-red spray — hard to miss.",
        tips=["Wait ~30 minutes. If blood quickly tapers off, the artery may have been missed — back out "
              "and wait several hours (muscle hit)."],
    ),
    "neck_vessels": dict(
        title="Neck — windpipe / major vessels", lethal=True, time="Minutes (if carotid/jugular cut)", wait_min=60,
        yards=(30, 120, 300),
        blood="Heavy bright-red if a major vessel is cut; frothy if the windpipe is hit.",
        tips=["Wait ~1 hour. If blood fades fast it was likely muscle only — back out, wait 4+ hours.",
              "Neck shots are inconsistent: a muscle-only neck hit usually means a deer that survives."],
    ),
    "single_lung": dict(
        title="Single lung", lethal=False, time="Hours — some deer survive", wait_min=240, yards=(150, 400, 900),
        blood="Bright red, some bubbles at first, often thinning out quickly.",
        tips=["Wait at least 4 hours (overnight is safer).",
              "Trails are often long; be ready to grid-search ahead of last blood.",
              "Many single-lung deer are not recovered — mark last blood carefully and get help."],
    ),
    "kidneys": dict(
        title="Kidneys", lethal=True, time="Minutes to ~1 hour (very vascular)", wait_min=60, yards=(50, 150, 300),
        blood="Dark red, can be heavy.",
        tips=["Wait 1–2 hours, then track."],
    ),
    "liver": dict(
        title="Liver", lethal=True, time="1–4 hours", wait_min=300, yards=(80, 200, 400),
        blood="Dark red (maroon) blood, moderate amount, no bubbles.",
        tips=["Wait 4–6 hours before tracking. Liver-hit deer usually bed within 200 yards if not pushed.",
              "If you jump the deer, stop, mark the spot and back out quietly — wait several more hours."],
    ),
    "paunch": dict(
        title="Stomach / intestines (gut shot)", lethal=True, time="8–16+ hours", wait_min=600, yards=(100, 250, 500),
        blood="Sparse, dark, may contain green/brown matter or have a foul smell; arrow smells and is greasy.",
        tips=["Wait at least 8–12 hours — overnight for an evening shot. Pushing a gut-shot deer early is the #1 way to lose it.",
              "Gut-shot deer usually bed in the nearest thick cover, often downhill and toward water.",
              "Start where the deer was hit and walk slowly; look for bedding spots with blood."],
    ),
    "muscle": dict(
        title="Muscle / non-vital", lethal=False, time="Usually survives", wait_min=120, yards=(100, 500, 1500),
        blood="Can start heavy then stop quickly; bright red, no bubbles.",
        tips=["Wait 1–2 hours, then follow the blood until it stops.",
              "If the trail dries up, the deer will most likely recover — note where it ended."],
    ),
    "shoulder_only": dict(
        title="Shoulder bone (no vitals reached)", lethal=False, time="Usually survives", wait_min=120,
        yards=(100, 500, 1500),
        blood="Little blood; limited penetration; deer often runs off normally.",
        tips=["With a bow, heavy shoulder bone often stops the arrow before the vitals.",
              "Track for sign, but most deer hit only in the shoulder blade recover."],
    ),
    "miss": dict(
        title="Miss (no body hit)", lethal=False, time="—", wait_min=0, yards=(0, 0, 0),
        blood="None expected.",
        tips=["Still check the impact area and the arrow for hair or blood to confirm a clean miss."],
    ),
}

PRIORITY = ["brain", "spine", "heart", "aorta", "double_lung", "femoral", "neck_vessels", "kidneys",
            "liver", "single_lung", "paunch", "shoulder_only", "muscle", "miss"]


def _primary(keys: set, bone_hit: bool) -> str:
    found = _found_from_keys(keys)
    if not found:
        return "shoulder_only" if bone_hit else "muscle"
    return min(found, key=PRIORITY.index)


def classify(res: ShotResult, weapon: str = "Bow") -> tuple[str, str | None, list[str]]:
    """(primary if the projectile passed through, primary if a bow arrow stopped at bone or None, notes)."""
    notes = []
    if res.missed:
        return "miss", None, notes
    bone = res.bone_first is not None
    primary = _primary(res.keys(), bone)
    stopped = None
    bow = weapon.lower().startswith(("bow", "cross"))
    if bow and bone and res.keys(include_after_bone=False) != res.keys():
        stopped = _primary(res.keys(include_after_bone=False), bone)
        if stopped == primary:
            stopped = None
        else:
            notes.append("The arrow path runs into the shoulder/leg bone. Bows often stop or deflect there — "
                         "see both outcomes below. Check how much of the arrow penetrated.")
    found = _found_from_keys(res.keys())
    if "paunch" in found and primary != "paunch":
        notes.append("Stomach/intestines also hit — expect gut matter on the arrow and a stronger odor; "
                     "if blood is sparse, treat it as a gut shot and wait longer.")
    if "liver" in found and ({"single_lung", "double_lung"} & found):
        notes.append("Lung + liver: usually fatal within an hour or two.")
    return primary, stopped, notes


def secondary_outcomes(primary: str, res: ShotResult) -> list[str]:
    return [OUTCOMES[k]["title"] for k in PRIORITY if k != primary and k in _found_from_keys(res.keys())]


def _found_from_keys(k: set) -> set:
    out = set()
    if len({"lung_l", "lung_r"} & k) == 2:
        out.add("double_lung")
    elif {"lung_l", "lung_r"} & k:
        out.add("single_lung")
    for key, grp in [("heart", {"heart"}), ("aorta", {"aorta"}), ("liver", {"liver"}), ("kidneys", {"kidneys"}),
                     ("paunch", {"rumen", "intestines"}), ("spine", {"spine", "neck_spine"}),
                     ("femoral", {"femoral_l", "femoral_r"}), ("neck_vessels", {"neck_vessels"}), ("brain", {"brain"})]:
        if grp & k:
            out.add(key)
    return out


# Evidence at the shot site / on the arrow → most likely hit (overrides geometry when the hunter has sign)
EVIDENCE = {
    "(not checked yet)": None,
    "Bright red, pink, frothy blood with bubbles": "double_lung",
    "Bright red blood, no bubbles": None,
    "Dark red / maroon blood": "liver",
    "Green or brown matter, foul smell, greasy arrow": "paunch",
    "White tallow / fat, little blood": "muscle",
    "Very heavy bright-red spray": "heart",
    "No blood, arrow clean": "miss",
}
REACTION = {
    "(didn't see)": None,
    "Mule kick / bucked, then ran hard and low": "Typical of heart/lung hits.",
    "Hunched up, walked or trotted off slowly": "Typical of a gut (stomach/intestine) or liver hit — wait longer.",
    "Dropped on the spot": "Spine/CNS — be ready for a follow-up shot.",
    "Ran off normally with tail up": "Often a miss or a superficial hit — check carefully for sign.",
    "Leg buckled / limping": "Possible leg or shoulder bone hit — often non-lethal.",
}


def stand_angle(height_ft: float, distance_yd: float) -> float:
    """Downward shot angle (deg) from stand height and horizontal distance."""
    if distance_yd <= 0:
        return 0.0
    return math.degrees(math.atan2(height_ft, distance_yd * 3))
