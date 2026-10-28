"""Persistent JSON storage for stands and the dev punch list.

Streamlit Community Cloud has an ephemeral filesystem — anything written to
local disk disappears when the app restarts — so production data is stored as
JSON files in the PRIVATE GitHub repo `jjpvoskuil/deercast-data` via the
Contents API (the app repo is public; stand GPS must not go there).

Streamlit secrets:

    [storage]
    github_token = "github_pat_..."   # fine-grained: Contents read/write on deercast-data only
    repo = "jjpvoskuil/deercast-data"
    branch = "main"
    path = "data"

Also supported: `[supabase]` (url, key) — see docs/supabase_setup.sql — and a
local-file fallback in ./.deercast_data/ for development.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import requests


class LocalStore:
    kind = "local"

    def __init__(self, root: str = ".deercast_data"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def get(self, name: str, default):
        p = self.root / f"{name}.json"
        if not p.exists():
            return default
        return json.loads(p.read_text())

    def put(self, name: str, obj, message: str = "") -> None:
        p = self.root / f"{name}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(obj, indent=2, default=str))


class GitHubStore:
    kind = "github"

    def __init__(self, token: str, repo: str, branch: str = "main", path: str = "data"):
        self.repo, self.branch, self.path = repo, branch, path.strip("/")
        self.s = requests.Session()
        self.s.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        )
        self._sha: dict[str, str] = {}

    def _url(self, name: str) -> str:
        return f"https://api.github.com/repos/{self.repo}/contents/{self.path}/{name}.json"

    def get(self, name: str, default):
        r = self.s.get(self._url(name), params={"ref": self.branch}, timeout=15)
        if r.status_code == 404:
            return default
        r.raise_for_status()
        body = r.json()
        self._sha[name] = body["sha"]
        return json.loads(base64.b64decode(body["content"]).decode())

    def put(self, name: str, obj, message: str = "") -> None:
        content = base64.b64encode(json.dumps(obj, indent=2, default=str).encode()).decode()
        payload = {"message": message or f"Update {name}", "content": content, "branch": self.branch}
        if name not in self._sha:
            self.get(name, None)
        if name in self._sha:
            payload["sha"] = self._sha[name]
        r = self.s.put(self._url(name), json=payload, timeout=15)
        if r.status_code == 409:  # stale sha — refetch once and retry
            self.get(name, None)
            payload["sha"] = self._sha.get(name)
            r = self.s.put(self._url(name), json=payload, timeout=15)
        r.raise_for_status()
        self._sha[name] = r.json()["content"]["sha"]


class SupabaseStore:
    kind = "supabase"
    TABLE = "deercast_kv"

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + f"/rest/v1/{self.TABLE}"
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Content-Type": "application/json"})
        if key.startswith("eyJ"):  # legacy JWT-style keys also go in Authorization
            self.s.headers["Authorization"] = f"Bearer {key}"

    def get(self, name: str, default):
        r = self.s.get(self.base, params={"name": f"eq.{name}", "select": "data"}, timeout=15)
        r.raise_for_status()
        rows = r.json()
        return rows[0]["data"] if rows else default

    def put(self, name: str, obj, message: str = "") -> None:
        body = {"name": name, "data": json.loads(json.dumps(obj, default=str))}
        r = self.s.post(
            self.base,
            params={"on_conflict": "name"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=body,
            timeout=15,
        )
        r.raise_for_status()


def _section(secrets, name) -> dict:
    try:
        if secrets is not None and name in secrets:
            return dict(secrets[name])
    except Exception:
        pass
    return {}


def make_store(secrets=None):

    cfg = _section(secrets, "storage")
    token = cfg.get("github_token") or os.environ.get("DEERCAST_GITHUB_TOKEN")
    repo = cfg.get("repo") or os.environ.get("DEERCAST_DATA_REPO")
    if token and repo:
        return GitHubStore(token, repo, cfg.get("branch", "main"), cfg.get("path", "data"))
    sb = _section(secrets, "supabase")
    url = sb.get("url") or os.environ.get("DEERCAST_SUPABASE_URL")
    key = sb.get("key") or os.environ.get("DEERCAST_SUPABASE_KEY")
    if url and key:
        return SupabaseStore(url, key)
    return LocalStore()
