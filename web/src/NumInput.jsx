import { useEffect, useRef, useState } from "react";

/** Number box that behaves on a phone: tapping it selects what's there, so typing replaces the 0 instead of
 *  appending to it; you can clear it while typing; it snaps into min–max when you leave the field.
 *  (iPhone Safari can't select the text of type="number" inputs — hence a text input with a number keypad.)
 *  `empty` = allow a blank value (onChange(null)). */
export default function NumInput({ value, onChange, min = -Infinity, max = Infinity, decimals = false, empty = false, ...rest }) {
  const show = (v) => (v == null || v === "" || Number.isNaN(v) ? "" : String(v));
  const [txt, setTxt] = useState(show(value));
  const focused = useRef(false), justFocused = useRef(false); // Safari clears the selection on mouseup after focus
  useEffect(() => { if (!focused.current) setTxt(show(value)); }, [value]);
  const clamp = (n) => Math.max(min, Math.min(max, n));
  const parse = (t) => (t === "" || t === "." || t === "-" ? NaN : decimals ? parseFloat(t) : parseInt(t, 10));
  return (
    <input {...rest} type="text" inputMode={decimals ? "decimal" : "numeric"} autoComplete="off" value={txt}
      onFocus={(e) => { focused.current = true; justFocused.current = true; e.target.select(); }}
      onMouseUp={(e) => { if (justFocused.current) { e.preventDefault(); justFocused.current = false; } }}
      onChange={(e) => {
        const t = e.target.value.replace(decimals ? /[^0-9.]/g : /[^0-9]/g, "");
        setTxt(t);
        const n = parse(t);
        if (!Number.isNaN(n)) onChange(clamp(n)); else if (empty) onChange(null);
      }}
      onBlur={() => {
        focused.current = false;
        const n = parse(txt);
        if (Number.isNaN(n)) { if (empty) { setTxt(""); onChange(null); } else setTxt(show(value)); return; }
        const c = clamp(n); setTxt(show(c)); onChange(c);
      }} />
  );
}
