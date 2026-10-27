"""Compass rose overlay for the Leaflet map (Leaflet maps are always north-up)."""

from __future__ import annotations

import math

from branca.element import MacroElement, Template


def compass_svg(wind_from_deg: float | None = None, wind_mph: float | None = None, size: int = 96) -> str:
    """SVG compass rose. If wind is given, an orange arrow shows where air (and scent) is moving."""
    c = size / 2
    r = c - 4
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">',
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="rgba(20,25,26,0.72)" stroke="#e8e6df" stroke-width="1.5"/>',
    ]
    # ticks every 22.5°, longer on cardinals
    for i in range(16):
        a = math.radians(i * 22.5)
        inner = r - (9 if i % 4 == 0 else 5 if i % 2 == 0 else 3)
        x1, y1 = c + inner * math.sin(a), c - inner * math.cos(a)
        x2, y2 = c + r * math.sin(a), c - r * math.cos(a)
        parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#e8e6df" stroke-width="1.2"/>')
    # north needle
    parts.append(f'<polygon points="{c},{c - r + 11} {c - 5},{c} {c + 5},{c}" fill="#d7261e"/>')
    parts.append(f'<polygon points="{c},{c + r - 11} {c - 5},{c} {c + 5},{c}" fill="#9aa39c"/>')
    # labels
    lr = r - 18
    style = 'font-family:-apple-system,Helvetica,Arial,sans-serif;font-weight:700;font-size:12px'
    for lbl, deg, col in (("N", 0, "#ff4d40"), ("E", 90, "#e8e6df"), ("S", 180, "#e8e6df"), ("W", 270, "#e8e6df")):
        a = math.radians(deg)
        x, y = c + lr * math.sin(a), c - lr * math.cos(a) + 4
        parts.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" fill="{col}" style="{style}">{lbl}</text>')
    # wind arrow: tail on the upwind side, head pointing downwind
    if wind_from_deg is not None:
        down = (wind_from_deg + 180) % 360
        L = r - 6
        parts.append(
            f'<g transform="rotate({down:.0f} {c} {c})">'
            f'<line x1="{c}" y1="{c + L}" x2="{c}" y2="{c - L + 10}" stroke="#ff8c1a" stroke-width="3.5" stroke-linecap="round"/>'
            f'<polygon points="{c},{c - L} {c - 7},{c - L + 12} {c + 7},{c - L + 12}" fill="#ff8c1a"/>'
            "</g>"
        )
    parts.append(f'<circle cx="{c}" cy="{c}" r="2.5" fill="#e8e6df"/>')
    parts.append("</svg>")
    return "".join(parts)


class Compass(MacroElement):
    """Leaflet control holding the compass SVG (plus a wind caption)."""

    _template = Template(
        """
        {% macro script(this, kwargs) %}
        (function() {
            var ctl = L.control({position: {{ this.position|tojson }}});
            ctl.onAdd = function() {
                var d = L.DomUtil.create('div', 'deercast-compass');
                d.style.cssText = 'pointer-events:none;text-align:center;line-height:1.1;';
                d.innerHTML = {{ this.html|tojson }};
                return d;
            };
            ctl.addTo({{ this._parent.get_name() }});
        })();
        {% endmacro %}
        """
    )

    def __init__(self, wind_from_deg=None, wind_mph=None, wind_label: str = "", position: str = "topright", size: int = 96):
        super().__init__()
        self._name = "Compass"
        self.position = position
        caption = ""
        if wind_label:
            caption = (
                '<div style="margin-top:2px;padding:1px 6px;border-radius:8px;background:rgba(20,25,26,0.72);'
                'color:#ff8c1a;font:600 11px -apple-system,Helvetica,Arial,sans-serif;display:inline-block">'
                f"{wind_label}</div>"
            )
        self.html = compass_svg(wind_from_deg, wind_mph, size) + caption
