// More → Chat: one room for everyone signed in to Deercast. Polls every 8 s while open (rules in schema.sql).
import { useEffect, useRef, useState } from "react";

export const CHAT_READ = "deercast.chatRead"; // when you last looked (ISO) → unread dot on More
const POLL_MS = 8000;
const when = (iso) => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString([], today ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function Chat({ db, me, active, toast, onRead }) {
  const [msgs, setMsgs] = useState(null);
  const [names, setNames] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const end = useRef(null);
  const count = useRef(0);
  const load = () => db.listChat().then((m) => {
    setMsgs(m);
    const last = m[m.length - 1]?.created;
    if (last) { try { localStorage.setItem(CHAT_READ, last); } catch { /* ignore */ } onRead?.(); }
  }).catch((e) => { setMsgs((x) => x || []); toast?.(`Chat didn't load — ${e.message}`); });
  useEffect(() => {
    if (!active) return;
    db.listUsers().then((us) => setNames(Object.fromEntries(us.map((u) => [u.email, u.name || u.email])))).catch(() => {});
    load();
    const i = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => clearInterval(i);
  }, [active, db]);
  // keep the newest message in view when new ones arrive
  useEffect(() => { if (msgs && msgs.length !== count.current) { count.current = msgs.length; setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 0); } }, [msgs]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await db.postChat(body.slice(0, 2000)); setText(""); await load(); }
    catch (e) { toast?.(`Couldn't send — ${e.message}`); }
    setBusy(false);
  };
  const admin = me?.role === "admin";
  if (msgs === null) return <p className="muted">Loading…</p>;
  return (
    <div className="chat">
      {!msgs.length && <p className="muted small">No messages yet. Everyone signed in to Deercast sees this chat.</p>}
      {msgs.map((m, i) => {
        const mine = m.author === db.email, first = i === 0 || msgs[i - 1].author !== m.author;
        return (
          <div key={m.id} className={`msg ${mine ? "mine" : ""}`}>
            {first && !mine && <div className="msg-who">{names[m.author] || m.author}</div>}
            <button className="msg-bubble" onClick={() => (mine || admin) && setDel(del === m.id ? null : m.id)}>{m.body}</button>
            <div className="msg-time">{when(m.created)}
              {del === m.id && <> · <button className="link danger-text" onClick={async () => { try { await db.deleteChat(m.id); setDel(null); load(); } catch (e) { toast?.(`Couldn't delete — ${e.message}`); } }}>Delete</button></>}</div>
          </div>
        );
      })}
      <div ref={end} />
      <div className="chat-send">
        <textarea rows="1" value={text} placeholder="Message everyone…" maxLength={2000} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
}
