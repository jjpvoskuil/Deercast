// Weapons you can pick anywhere in the app: your saved bow setups, your saved guns, and plain generic types.
// Stored in the "gear" doc: { setups: [bows], active, guns: [guns], active_gun }.

const GENERIC = [
  { id: "g:Bow", label: "Bow (no setup)", weapon: "Bow", kind: "bow" },
  { id: "g:Crossbow", label: "Crossbow (no setup)", weapon: "Crossbow", kind: "bow" },
  { id: "g:Rifle", label: "Rifle (no setup)", weapon: "Rifle / shotgun slug", kind: "gun" },
  { id: "g:Slug", label: "Shotgun slug (no setup)", weapon: "Rifle / shotgun slug", kind: "gun" },
  { id: "g:Muzzleloader", label: "Muzzleloader (no setup)", weapon: "Muzzleloader", kind: "gun" },
];

/** [{id, label, weapon (category the hit model uses), kind: "bow"|"gun", setup}] — your setups first. */
export function weaponOptions(gear) {
  const bows = (gear?.setups || []).map((s) => ({ id: `bow:${s.id}`, label: `${s.name} — ${s.bow_type || "bow"}`, weapon: s.bow_type === "Crossbow" ? "Crossbow" : "Bow", kind: "bow", setup: s }));
  const guns = (gear?.guns || []).map((s) => ({ id: `gun:${s.id}`, label: `${s.name} — ${s.cartridge || s.type}`, weapon: s.type === "Muzzleloader" ? "Muzzleloader" : "Rifle / shotgun slug", kind: "gun", setup: s }));
  return [...bows, ...guns, ...GENERIC];
}
export const findWeapon = (gear, id) => weaponOptions(gear).find((o) => o.id === id) || null;
/** The weapon to preselect: the given one if it still exists, else your active bow, else your active gun, else "Bow". */
export function defaultWeaponId(gear, prefer) {
  const opts = weaponOptions(gear);
  if (prefer && opts.some((o) => o.id === prefer)) return prefer;
  if (gear?.active && opts.some((o) => o.id === `bow:${gear.active}`)) return `bow:${gear.active}`;
  if (gear?.active_gun && opts.some((o) => o.id === `gun:${gear.active_gun}`)) return `gun:${gear.active_gun}`;
  return opts[0]?.id || "g:Bow";
}
/** Older shots stored only a weapon name ("Bow", "Rifle / shotgun slug"…) → closest generic option. */
export function weaponIdFor(gear, rec) {
  if (rec?.weapon_id && findWeapon(gear, rec.weapon_id)) return rec.weapon_id;
  const w = String(rec?.weapon || "");
  if (/cross/i.test(w)) return "g:Crossbow";
  if (/muzzle/i.test(w)) return "g:Muzzleloader";
  if (/slug/i.test(w) && !/rifle/i.test(w)) return "g:Slug";
  if (/rifle|gun/i.test(w)) return "g:Rifle";
  return defaultWeaponId(gear);
}
