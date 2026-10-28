"""Users, hunting grounds, and where each kind of data is stored.

Layout in the data store (private `deercast-data` repo):
    users.json                       {email: {"name", "role": "admin"|"user", "last_ground"}}
    grounds.json                     [{"id", "name", "owner", "members": [emails], "home": {...}, "created"}]
    grounds/<ground id>/stands.json  shared with the ground's members
    grounds/<ground id>/features.json
    users/<user id>/hunts.json       personal (hunts carry "ground_id")
    users/<user id>/active_hunt.json, gear.json, shots.json
    punchlist.json                   app-wide (admin only)

The pre-multi-user files (stands.json, features.json, hunts.json, …) are migrated once into the first admin's
first ground and left in place as a backup.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime

GROUND_SCOPED = {"stands", "features"}
USER_SCOPED = {"hunts", "active_hunt", "gear", "shots"}
LEGACY = ["stands", "features", "hunts", "active_hunt", "gear", "shots"]
LOCAL_EMAIL = "local"  # identity used in password mode when no ADMIN_EMAIL is configured


def norm_email(email: str) -> str:
    return (email or "").strip().lower()


def uid(email: str) -> str:
    """Stable, non-reversible folder name for a user."""
    return hashlib.sha256(norm_email(email).encode()).hexdigest()[:12]


def path_for(name: str, user_email: str | None, ground_id: str | None) -> str:
    if name in GROUND_SCOPED:
        if not ground_id:
            raise ValueError(f"'{name}' needs a hunting ground")
        return f"grounds/{ground_id}/{name}"
    if name in USER_SCOPED:
        if not user_email:
            raise ValueError(f"'{name}' needs a signed-in user")
        return f"users/{uid(user_email)}/{name}"
    return name


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def new_ground(name: str, owner: str, home: dict) -> dict:
    return {"id": uuid.uuid4().hex[:8], "name": name.strip(), "owner": norm_email(owner),
            "members": [norm_email(owner)], "home": home, "created": now_str()}


def my_grounds(grounds: list[dict], email: str) -> list[dict]:
    e = norm_email(email)
    return [g for g in grounds if e in g.get("members", [])]


def can_edit_ground(g: dict, email: str) -> bool:
    return norm_email(email) == g.get("owner")


def bootstrap_users(users: dict, admins: list[str]) -> tuple[dict, bool]:
    """Make sure every configured admin exists as an admin user. Returns (users, changed)."""
    changed = False
    for a in admins:
        a = norm_email(a)
        if not a:
            continue
        rec = users.get(a)
        if rec is None:
            users[a] = {"name": a.split("@")[0], "role": "admin", "last_ground": None}
            changed = True
        elif rec.get("role") != "admin":
            rec["role"] = "admin"
            changed = True
    return users, changed


def migrate_legacy(store, owner_email: str, ground_name: str, default_home: dict) -> dict | None:
    """One-time move of single-user data into a first ground + the owner's personal folder.

    Returns the new ground, or None if grounds already exist. Legacy files are not deleted."""
    if store.get("grounds", None) is not None:
        return None
    owner = norm_email(owner_email)
    stands = store.get("stands", [])
    home = dict(default_home)
    if stands:
        home.update(lat=round(sum(s["lat"] for s in stands) / len(stands), 5),
                    lon=round(sum(s["lon"] for s in stands) / len(stands), 5))
    home["label"] = ground_name
    g = new_ground(ground_name, owner, home)
    for name in LEGACY:
        data = store.get(name, None)
        if data is None:
            continue
        if name == "hunts":
            for h in data:
                h.setdefault("ground_id", g["id"])
        if name == "active_hunt" and data:
            data.setdefault("ground_id", g["id"])
        store.put(path_for(name, owner, g["id"]), data, f"Migrate {name} → {ground_name}")
    store.put("grounds", [g], f"Create ground {ground_name}")
    users = store.get("users", {}) or {}
    users.setdefault(owner, {"name": owner.split("@")[0], "role": "admin", "last_ground": g["id"]})
    users[owner]["last_ground"] = g["id"]
    store.put("users", users, "Users: first admin")
    return g


def claim_local(store, email: str) -> bool:
    """If data was set up in password mode under the placeholder 'local' identity, hand it to this admin email.
    Copies personal files and swaps 'local' for the email in grounds and users. Returns True if anything moved."""
    email = norm_email(email)
    grounds = store.get("grounds", []) or []
    users = store.get("users", {}) or {}
    if LOCAL_EMAIL not in users and not any(LOCAL_EMAIL in g.get("members", []) for g in grounds):
        return False
    for name in USER_SCOPED:
        data = store.get(path_for(name, LOCAL_EMAIL, None), None)
        if data is not None and store.get(path_for(name, email, None), None) is None:
            store.put(path_for(name, email, None), data, f"Claim {name} for {email}")
    for g in grounds:
        g["members"] = [email if m == LOCAL_EMAIL else m for m in g.get("members", [])]
        g["members"] = list(dict.fromkeys(g["members"]))
        if g.get("owner") == LOCAL_EMAIL:
            g["owner"] = email
    store.put("grounds", grounds, "Grounds: claim local owner")
    rec = users.pop(LOCAL_EMAIL, {"role": "admin"})
    users.setdefault(email, {"name": email.split("@")[0], "role": "admin", "last_ground": rec.get("last_ground")})
    users[email]["role"] = "admin"
    store.put("users", users, "Users: claim local")
    return True
