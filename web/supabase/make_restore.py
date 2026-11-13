"""Turn a Supabase backup (deercast-data/backups/supabase/*.json, made by its backup workflow) into SQL that
replaces the database contents. Output contains private data — send it to John as a file, never commit it.

    python web/supabase/make_restore.py <deercast-data>/backups/supabase > deercast_restore.sql
Run supabase/schema.sql first if the tables don't exist (fresh project), then paste this into the SQL Editor.
"""
import json
import sys
from pathlib import Path

ORDER = ["app_users", "grounds", "stands", "features", "hunts", "shots", "user_docs", "punchlist", "chat"]  # FK-safe
COLS = {"app_users": ["email", "name", "role"], "grounds": ["id", "name", "owner", "members", "home", "created"],
        "stands": ["id", "ground_id", "data"], "features": ["id", "ground_id", "data"],
        "hunts": ["id", "ground_id", "owner", "data"], "shots": ["id", "ground_id", "owner", "data"],
        "user_docs": ["owner", "name", "data"], "punchlist": ["id", "data"],
        "chat": ["id", "created", "author", "body"]}


def lit(v, col):
    if v is None:
        return "null"
    if col == "members":
        return "array[" + ",".join(lit(x, "") for x in v) + "]::text[]"
    if isinstance(v, (dict, list)) or col in ("data", "home"):
        return "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def main(folder):
    d = Path(folder)
    out = ["-- Deercast restore (generated from a backup). Contains private data — do not commit.", "begin;"]
    out += [f"delete from public.{t};" for t in reversed(ORDER)]
    counts = {}
    for t in ORDER:
        p = d / f"{t}.json"
        rows = json.loads(p.read_text()) if p.exists() else []
        counts[t] = len(rows)
        for r in rows:
            cols = COLS[t]
            out.append(f"insert into public.{t} ({', '.join(cols)}) values ({', '.join(lit(r.get(c), c) for c in cols)});")
    out.append("commit;")
    out.append("select 'Restored " + ", ".join(f"{n} {t}" for t, n in counts.items()) + "' as result;")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1])
