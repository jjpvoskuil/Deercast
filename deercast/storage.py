"""Persistent JSON storage for stands and the dev punch list.

Streamlit Community Cloud has an ephemeral filesystem — anything written to
local disk disappears when the app restarts. So in production we store JSON
files in a GitHub repo via the Contents API.

IMPORTANT: point this at a PRIVATE repo (e.g. `deercast-data`), not the public
app repo, so stand GPS coordinates aren't public. Also avoid the branch the app
deploys from — every data commit would trigger a redeploy.

Configure in Streamlit secrets:

    [storage]
    github_token = "github_pat_..."   # fine-grained, Contents: read/write on the data repo only
    repo = "jjpvoskuil/deercast-data"
    branch = "main"
    path = "data"

Without those secrets, falls back to local files in ./.deercast_data/ (dev only).
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
        (self.root / f"{name}.json").write_text(json.dumps(obj, indent=2, default=str))


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


def make_store(secrets=None):
    cfg = {}
    try:
        if secrets is not None and "storage" in secrets:
            cfg = dict(secrets["storage"])
    except Exception:
        cfg = {}
    token = cfg.get("github_token") or os.environ.get("DEERCAST_GITHUB_TOKEN")
    repo = cfg.get("repo") or os.environ.get("DEERCAST_DATA_REPO")
    if token and repo:
        return GitHubStore(token, repo, cfg.get("branch", "main"), cfg.get("path", "data"))
    return LocalStore()
