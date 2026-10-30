"""Build a one-time SQL import of the private deercast-data repo into the Deercast Supabase project.

    python web/supabase/make_import.py /path/to/deercast-data/data  >  deercast_import.sql

The OUTPUT contains stand coordinates and hunts: never commit it. Paste it into Supabase → SQL Editor → Run.
Re-running it replaces the web copy with whatever is in the data repo now (Streamlit stays the source of truth).
"""
import glob
import hashlib
import json
import os
import sys


def q(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def j(o) -> str:
    return q(json.dumps(o, default=str)) + "::jsonb"


def main(root: str) -> None:
    users = json.load(open(os.path.join(root, "users.json")))
    grounds = json.load(open(os.path.join(root, "grounds.json")))
    by_hash = {hashlib.sha256(e.strip().lower().encode()).hexdigest()[:12]: e.strip().lower() for e in users}

    out = ["-- Deercast web import (generated). Contains private data — do not commit.", "begin;",
           "delete from public.hunts; delete from public.features; delete from public.stands;",
           "delete from public.grounds; delete from public.app_users;"]
    for email, u in users.items():
        out.append(f"insert into public.app_users (email, name, role) values "
                   f"({q(email.strip().lower())}, {q(u.get('name') or '')}, {q(u.get('role') or 'member')});")
    gids = set()
    for g in grounds:
        gids.add(g["id"])
        members = "array[" + ",".join(q(m.strip().lower()) for m in g.get("members", [])) + "]::text[]"
        out.append(f"insert into public.grounds (id, name, owner, members, home, created) values "
                   f"({q(g['id'])}, {q(g['name'])}, {q(g['owner'].strip().lower())}, {members}, "
                   f"{j(g.get('home'))}, {q(g.get('created') or '')});")
        for table in ("stands", "features"):
            p = os.path.join(root, "grounds", g["id"], f"{table}.json")
            for row in (json.load(open(p)) if os.path.exists(p) else []):
                out.append(f"insert into public.{table} (id, ground_id, data) values "
                           f"({q(g['id'] + ':' + row['id'])}, {q(g['id'])}, {j(row)});")
    n_hunts = 0
    for p in glob.glob(os.path.join(root, "users", "*", "hunts.json")):
        owner = by_hash.get(os.path.basename(os.path.dirname(p)))
        if not owner:
            continue
        for h in json.load(open(p)):
            if h.get("ground_id") not in gids:
                continue
            n_hunts += 1
            out.append(f"insert into public.hunts (id, ground_id, owner, data) values "
                       f"({q(owner + ':' + h['id'])}, {q(h['ground_id'])}, {q(owner)}, {j(h)});")
    out.append("commit;")
    out.append(f"select 'Imported {len(users)} users, {len(grounds)} grounds, {n_hunts} hunts' as result;")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../deercast-data/data")
