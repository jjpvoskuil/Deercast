// Pieces every screen shares: the ground chip + theme button, the ground/appearance menu, and the tab bar.
import Icon from "./Icon.jsx";

export const TABS = [["forecast", "Forecast", "chart"], ["map", "Map", "map"], ["log", "Hunt Log", "log"], ["shot", "Shot", "target"], ["more", "More", "more"]];
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function GroundChip({ ground, onClick, demo }) {
  return (
    <>
      <button className="chip" onClick={onClick}>
        <Icon name="pin" className="icon pin" size={18} /><span>{ground?.name || "—"}</span><Icon name="chev" size={16} />
      </button>
      {demo && <span className="demo">DEMO</span>}
    </>
  );
}

export function ThemeButton({ theme }) {
  return (
    <button className="round" onClick={theme.flip} aria-label={theme.theme === "dark" ? "Switch to light" : "Switch to dark"}>
      <Icon name={theme.theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

export function Menu({ open, onClose, ground, grounds, onGround, theme, email, onSignOut, onManage }) {
  if (!open) return null;
  return (
    <div className="menu" onClick={onClose}>
      <div className="menu-card" onClick={(e) => e.stopPropagation()}>
        <div className="menu-h">Hunting ground</div>
        {grounds.map((g) => (
          <button key={g.id} className={`menu-row ${g.id === ground?.id ? "on" : ""}`} onClick={() => { onGround(g.id); onClose(); }}>
            {g.id === ground?.id ? <Icon name="check" size={18} /> : <span style={{ width: 18 }} />}{g.name}
          </button>
        ))}
        {onManage && <button className="menu-row" onClick={onManage}><Icon name="more" size={18} />Manage grounds…</button>}
        <div className="menu-h">Appearance</div>
        <div className="seg">
          {[["auto", "Automatic"], ["light", "Light"], ["dark", "Dark"]].map(([m, l]) => (
            <button key={m} className={theme.mode === m ? "on" : ""} onClick={() => theme.choose(m)}>{l}</button>
          ))}
        </div>
        <div className="menu-h" style={{ paddingTop: 0 }}>
          {theme.mode === "auto" && `Dark from ${fmtTime(theme.darkStart)} to ${fmtTime(theme.lightStart)} (30 min around sunset/sunrise).`}
          {theme.mode === "temp" && `${theme.theme === "dark" ? "Dark" : "Light"} until ${fmtTime(theme.next)}, then automatic.`}
          {(theme.mode === "light" || theme.mode === "dark") && "Stays this way until you pick Automatic."}
        </div>
        <div className="menu-h">Signed in</div>
        <div className="menu-row muted">{email}</div>
        <button className="menu-row" onClick={onSignOut}>Sign out</button>
        <div className="muted small" style={{ padding: "6px 4px" }}>App updated {typeof __BUILD__ === "undefined" ? "dev" : __BUILD__}</div>
      </div>
    </div>
  );
}

export function TabBar({ tab, onTab, built }) {
  return (
    <nav className="tabbar">
      {TABS.map(([id, label, ic]) => (
        <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined}
          onClick={() => onTab(id, built.includes(id))}>
          <Icon name={ic} /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
