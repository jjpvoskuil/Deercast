import pytest


@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path, monkeypatch):
    """Each test gets its own empty local data folder."""
    monkeypatch.chdir(tmp_path)
