import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from unittest import mock
from deercast import storage


def test_supabase_selected_and_requests_shape():
    st = storage.make_store({"supabase": {"url": "https://x.supabase.co", "key": "sb_secret_abc"}})
    assert st.kind == "supabase" and "Authorization" not in st.s.headers
    with mock.patch.object(st.s, "get") as g, mock.patch.object(st.s, "post") as p:
        g.return_value.json.return_value = [{"data": [{"name": "A"}]}]
        assert st.get("stands", []) == [{"name": "A"}]
        assert g.call_args.kwargs["params"]["name"] == "eq.stands"
        st.put("stands", [{"name": "B"}])
        assert p.call_args.kwargs["json"] == {"name": "stands", "data": [{"name": "B"}]}
        assert "merge-duplicates" in p.call_args.kwargs["headers"]["Prefer"]


def test_fallback_local(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert storage.make_store({}).kind == "local"
