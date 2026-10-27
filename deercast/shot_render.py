"""Matplotlib rendering for the shot page: shooter's-eye deer view + arrow-path diagram."""

from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from .shot import BODY, BY_KEY, ORGANS, Part, view_basis  # noqa: E402

# Fixed view window (inches) so taps map linearly to model coordinates.
X_MIN, X_MAX, Y_MIN, Y_MAX = -48.0, 48.0, -40.0, 40.0
PX_W, PX_H = 720, 600
BG = "#33402f"

DECOR = [
    Part("ear_l", "", (31, 3, 22.5), (1.4, 0.8, 3.4), "body", "#8d6440"),
    Part("ear_r", "", (31, -3, 22.5), (1.4, 0.8, 3.4), "body", "#7e5a3a"),
    Part("tail", "", (-21, 0, 5), (1.6, 1.3, 3.2), "body", "#f2efe6"),
    Part("nose", "", (40, 0, 16), (1.4, 1.3, 1.3), "body", "#2a2018"),
    Part("eye_l", "", (36.5, 2.9, 19), (0.8, 0.4, 0.7), "body", "#1a1410"),
    Part("eye_r", "", (36.5, -2.9, 19), (0.8, 0.4, 0.7), "body", "#1a1410"),
    Part("hoof_fl", "", (14.5, 4, -35.5), (2, 1.6, 1), "body", "#2a2018"),
    Part("hoof_fr", "", (14.5, -4, -35.5), (2, 1.6, 1), "body", "#2a2018"),
    Part("hoof_rl", "", (-16.5, 4, -35.5), (2, 1.6, 1), "body", "#2a2018"),
    Part("hoof_rr", "", (-16.5, -4, -35.5), (2, 1.6, 1), "body", "#2a2018"),
]


def _ellipse(part: Part, r, u, n=60):
    """Exact 2D outline of an axis-aligned ellipsoid projected onto the (r, u) screen plane."""
    P = np.vstack([r, u])  # 2x3
    A = np.diag(np.asarray(part.semi, float) ** 2)
    M = P @ A @ P.T
    L = np.linalg.cholesky(M + 1e-9 * np.eye(2))
    t = np.linspace(0, 2 * np.pi, n)
    pts = (L @ np.vstack([np.cos(t), np.sin(t)])).T + P @ np.asarray(part.center, float)
    return pts


def _shade(hex_color: str, f: float) -> str:
    c = matplotlib.colors.to_rgb(hex_color)
    return matplotlib.colors.to_hex([min(1, max(0, v * f)) for v in c])


def screen_to_model(px: float, py: float, disp_w: float, disp_h: float, mirror: bool) -> tuple[float, float]:
    sx = X_MIN + (px / disp_w) * (X_MAX - X_MIN)
    sy = Y_MAX - (py / disp_h) * (Y_MAX - Y_MIN)
    return (-sx if mirror else sx), sy


def deer_view(yaw: float, pitch: float, mirror: bool = False, crosshair=None, vitals: bool = True,
              hit_keys: set | None = None, antlers: bool = True) -> Image.Image:
    """Shooter's-eye view. crosshair = (sx, sy) in model screen coords (pre-mirror)."""
    d, r, u = view_basis(yaw, pitch)
    fig = plt.figure(figsize=(PX_W / 100, PX_H / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(X_MIN, X_MAX)
    ax.set_ylim(Y_MIN, Y_MAX)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor(BG)
    flip = -1.0 if mirror else 1.0

    # ground shadow
    ax.add_patch(matplotlib.patches.Ellipse((0, -36.5), 70, 6, color="#000000", alpha=0.25, lw=0))

    parts = BODY + DECOR
    order = sorted(parts, key=lambda p: -float(np.dot(p.center, d)))  # far → near
    for p in order:
        pts = _ellipse(p, r, u)
        depth = float(np.dot(p.center, d))
        col = _shade(p.color, 0.78) if depth > 2 else p.color
        ax.fill(flip * pts[:, 0], pts[:, 1], color=col, lw=0, zorder=2)
    if antlers:
        for side in (1, -1):
            beam = np.array([[31, 1.5 * side, 21], [29, 5 * side, 26], [31, 7 * side, 29], [36, 6.5 * side, 31],
                             [40, 4.5 * side, 30.5]])
            tines = [np.array([[30.5, 6 * side, 28], [31, 6.5 * side, 33]]),
                     np.array([[34, 7 * side, 30.5], [34.5, 7.5 * side, 35]]),
                     np.array([[37.5, 5.8 * side, 31], [38.5, 6 * side, 34.5]])]
            for line in [beam] + tines:
                xy = line @ np.vstack([r, u]).T
                ax.plot(flip * xy[:, 0], xy[:, 1], color="#e6d8b8", lw=3, solid_capstyle="round", zorder=2.6)
    # belly highlight
    belly = Part("belly", "", (2, 0, -6.5), (15, 6.5, 3.5), "body", "#d9c3a0")
    pts = _ellipse(belly, r, u)
    ax.fill(flip * pts[:, 0], pts[:, 1], color="#c9ad84", alpha=0.35, lw=0, zorder=2.5)

    if vitals:
        for p in sorted(ORGANS, key=lambda p: -float(np.dot(p.center, d))):
            pts = _ellipse(p, r, u)
            hit = hit_keys is not None and p.key in hit_keys
            ax.fill(flip * pts[:, 0], pts[:, 1], color=p.color, alpha=0.75 if hit else 0.38, lw=0, zorder=3)
            if hit:
                ax.plot(flip * pts[:, 0], pts[:, 1], color="#ffffff", lw=1.2, zorder=3.5)

    if crosshair is not None:
        cx, cy = flip * crosshair[0], crosshair[1]
        kw = dict(color="#ff3b30", lw=2.2, zorder=5, solid_capstyle="round")
        ax.add_patch(matplotlib.patches.Circle((cx, cy), 3.2, fill=False, color="#ff3b30", lw=2.2, zorder=5))
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ax.plot([cx + dx * 1.2, cx + dx * 6], [cy + dy * 1.2, cy + dy * 6], **kw)
        ax.plot([cx], [cy], "o", color="#ff3b30", ms=3, zorder=6)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def path_diagram(res, mirror: bool = False) -> Image.Image:
    """Top view and side view of the arrow path through the body."""
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 8.4), dpi=100, gridspec_kw={"height_ratios": [30, 64]})
    fig.patch.set_facecolor(BG)
    hit = {h.key for h in res.hits}
    ys = -1.0 if mirror else 1.0
    for ax, (i, j), title in ((ax1, (0, 1), "Top view (head →)"), (ax2, (0, 2), "Side view (head →)")):
        ax.set_facecolor(BG)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.set_title(title, color="#e8e6df", fontsize=10, loc="left")
        for p in BODY:
            if i == 0 and j == 1 and p.key.startswith("leg"):
                continue
            c, a = np.array(p.center, float), np.array(p.semi, float)
            ax.add_patch(matplotlib.patches.Ellipse((c[i], c[j] * (ys if j == 1 else 1)), 2 * a[i], 2 * a[j],
                                                    color=p.color, alpha=0.55, lw=0))
        for p in ORGANS:
            c, a = np.array(p.center, float), np.array(p.semi, float)
            on = p.key in hit
            ax.add_patch(matplotlib.patches.Ellipse((c[i], c[j] * (ys if j == 1 else 1)), 2 * a[i], 2 * a[j],
                                                    color=p.color, alpha=0.95 if on else 0.3,
                                                    ec="#ffffff" if on else "none", lw=1.2))
        if not res.missed:
            e, x = res.entry, res.exit
            ax.annotate("", xy=(x[i], x[j] * (ys if j == 1 else 1)), xytext=(e[i], e[j] * (ys if j == 1 else 1)),
                        arrowprops=dict(arrowstyle="-|>", color="#ff8c1a", lw=2.5))
            ax.plot([e[i]], [e[j] * (ys if j == 1 else 1)], "o", color="#ff3b30", ms=6)
            dvec = (x - e) / max(np.linalg.norm(x - e), 1e-6)
            src = e - 9 * dvec
            ax.annotate("from you", xy=(e[i], e[j] * (ys if j == 1 else 1)),
                        xytext=(src[i], src[j] * (ys if j == 1 else 1)), color="#ffd60a", fontsize=8,
                        ha="center", va="center", arrowprops=dict(arrowstyle="-", color="#ffd60a", ls=":", lw=1))
        ax.set_xlim(-30, 46)
        ax.set_ylim(-15, 15) if j == 1 else ax.set_ylim(-37, 26)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def organ_legend() -> list[tuple[str, str]]:
    seen, out = set(), []
    for p in ORGANS:
        lbl = p.label.replace(" (L)", "").replace(" (R)", "").replace("Left ", "").replace("Right ", "")
        if lbl not in seen:
            seen.add(lbl)
            out.append((lbl, p.color))
    return out


__all__ = ["deer_view", "path_diagram", "screen_to_model", "organ_legend", "BY_KEY"]
