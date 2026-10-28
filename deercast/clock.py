"""Live, client-side hunt clock: time on stand (counts up) and countdowns to legal light / sunrise / sunset /
end of legal hunting. Runs in the phone's browser, so it ticks every second without reloading the page."""

from __future__ import annotations

import json

import pandas as pd

from . import astro


def sun_targets(lat: float, lon: float, day, tz: str, legal_min: int = 30) -> dict:
    a = astro.daily_astro(lat, lon, [pd.Timestamp(day).date()], tz)
    sr, ss = a["sunrise"].iloc[0], a["sunset"].iloc[0]
    return {
        "legal_start": sr - pd.Timedelta(minutes=legal_min),
        "sunrise": sr,
        "sunset": ss,
        "legal_end": ss + pd.Timedelta(minutes=legal_min),
    }


def hunt_period(ref: pd.Timestamp, t: dict) -> str:
    """'morning' if the reference time is before mid-day (between sunrise and sunset), else 'evening'."""
    midday = t["sunrise"] + (t["sunset"] - t["sunrise"]) / 2
    return "morning" if ref < midday else "evening"


def clock_html(start: pd.Timestamp | None, targets: dict, period: str) -> str:
    if period == "morning":
        items = [("Legal shooting light", targets["legal_start"], "starts"),
                 ("Sunrise", targets["sunrise"], "starts")]
    else:
        items = [("Sunset", targets["sunset"], "ends"),
                 ("Legal shooting light", targets["legal_end"], "ends")]
    data = {
        "start": start.isoformat() if start is not None else None,
        "items": [{"label": lbl, "t": ts.isoformat(), "kind": kind, "clock": ts.strftime("%-I:%M %p")}
                  for lbl, ts, kind in items],
    }
    return """
<div id="dc" style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#e8e6df;background:#1f2725;
     border-radius:12px;padding:10px 14px;line-height:1.35">
  <div id="up" style="font-size:15px;opacity:.85"></div>
  <div id="rows"></div>
</div>
<script>
const D = __DATA__;
function fmt(ms){ms=Math.max(0,Math.floor(ms/1000));const h=Math.floor(ms/3600),m=Math.floor(ms%3600/60),s=ms%60;
  return (h>0?h+":"+String(m).padStart(2,"0"):m)+":"+String(s).padStart(2,"0");}
function tick(){
  const now=Date.now();
  const up=document.getElementById("up");
  if(D.start){up.innerHTML="⏱️ On stand <b style='font-size:22px;color:#fff'>"+fmt(now-Date.parse(D.start))+"</b>";}
  else{up.style.display="none";}
  let html="";
  for(const it of D.items){
    const dt=Date.parse(it.t)-now;
    let txt, col;
    if(dt>0){
      txt=it.label+" "+it.kind+" in <b style='font-size:20px'>"+fmt(dt)+"</b> <span style='opacity:.6'>("+it.clock+")</span>";
      col = (it.kind==="ends" && dt<15*60000) ? "#ff8c1a" : "#ffd60a";
    } else {
      txt=it.label+" "+(it.kind==="starts"?"has started":"has ENDED")+" <span style='opacity:.6'>("+it.clock+")</span>";
      col = it.kind==="starts" ? "#7bd88f" : "#ff5a4f";
    }
    html+="<div style='margin-top:4px;color:"+col+"'>"+txt+"</div>";
  }
  document.getElementById("rows").innerHTML=html;
}
tick(); setInterval(tick,1000);
</script>
""".replace("__DATA__", json.dumps(data))
