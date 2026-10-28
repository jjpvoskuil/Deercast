"""Bow / crossbow setup math: estimated arrow speed, kinetic energy, momentum and a bone-penetration rating.

Rules of thumb (standard archery-industry approximations; a chronograph reading beats any estimate):
- Compound speed from the IBO/ATA rating (measured at 30" draw, 70 lb, 350 gr):
    −10 fps per inch of draw length under 30"
    −1 fps per 3 gr of arrow weight above 5 gr per lb of draw weight
    −1 fps per 3 gr of string accessories (peep, loop, silencers)
    −~1.7 fps per lb of draw weight under 70 lb (less stored energy)
- Crossbow: rated speed at the rated bolt weight, scaled by constant energy: v = v_r·√(m_r / m).
- Kinetic energy (ft·lb) = grains × fps² / 450,800
- Momentum (slug·ft/s) = grains × fps / 225,218
"""

from __future__ import annotations

import math

TIP_FACTOR = {  # relative ability to keep penetrating through hide/bone
    "Fixed-blade broadhead": 1.0,
    "Hybrid broadhead": 0.85,
    "Mechanical / expandable broadhead": 0.72,
    "Field point / target": 0.9,
}
BOW_TYPES = ["Compound", "Crossbow", "Recurve / longbow"]


def estimate_speed(setup: dict) -> float | None:
    """Estimated arrow speed (fps), or the chronograph speed if entered."""
    if setup.get("chrono_fps"):
        return float(setup["chrono_fps"])
    kind = setup.get("bow_type", "Compound")
    aw = float(setup.get("arrow_gr") or 0)
    if aw <= 0:
        return None
    if kind == "Crossbow":
        vr, mr = float(setup.get("rated_fps") or 0), float(setup.get("rated_bolt_gr") or 400)
        return vr * math.sqrt(mr / aw) if vr else None
    dw = float(setup.get("draw_weight") or 0)
    if kind == "Compound":
        ibo = float(setup.get("rated_fps") or 0)
        if not ibo or not dw:
            return None
        dl = float(setup.get("draw_length") or 30)
        v = ibo - 10 * (30 - dl) - max(0.0, aw - 5 * dw) / 3 - float(setup.get("string_gr") or 0) / 3
        v -= max(0.0, 70 - dw) * 1.7
        return max(v, 120.0)
    # traditional: rough ~ 1.9 fps per lb at ~9 gr/lb, slower with heavier arrows
    if not dw:
        return None
    return max(110.0, 120 + 1.25 * dw - max(0.0, aw - 9 * dw) / 6)


def kinetic_energy(gr: float, fps: float) -> float:
    return gr * fps * fps / 450_800


def momentum(gr: float, fps: float) -> float:
    return gr * fps / 225_218


def ke_class(ke: float) -> str:
    if ke < 25:
        return "Small game only"
    if ke < 42:
        return "Adequate for deer"
    if ke < 65:
        return "Deer, black bear, elk"
    return "Any North American game"


def bone_rating(setup: dict) -> tuple[str, float]:
    """('High'|'Moderate'|'Low', effective momentum) — chance to break through a deer's shoulder blade."""
    v = estimate_speed(setup)
    if not v:
        return "Unknown", 0.0
    m = momentum(float(setup["arrow_gr"]), v) * TIP_FACTOR.get(setup.get("tip_type", ""), 0.85)
    if m >= 0.52:
        return "High", m
    if m >= 0.40:
        return "Moderate", m
    return "Low", m


def summary(setup: dict) -> dict:
    v = estimate_speed(setup)
    if not v:
        return {}
    gr = float(setup["arrow_gr"])
    ke, mo = kinetic_energy(gr, v), momentum(gr, v)
    rating, eff = bone_rating(setup)
    return {"fps": v, "ke": ke, "momentum": mo, "ke_class": ke_class(ke), "bone": rating, "eff_momentum": eff,
            "gpp": gr / float(setup["draw_weight"]) if setup.get("draw_weight") else None,
            "measured": bool(setup.get("chrono_fps"))}


def flight_time(fps: float, yards: float) -> float:
    """Seconds to target, with ~1.5% speed loss per 10 yd (light drag)."""
    if fps <= 0:
        return math.nan
    avg = fps * (1 - 0.0075 * yards / 10)
    return yards * 3 / avg
