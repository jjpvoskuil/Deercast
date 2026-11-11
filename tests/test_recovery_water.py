"""Recovery map: open water is never a probable spot, and the deer doesn't swim across (John, 2026-11-11)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "tests"))

import numpy as np
import pytest

from deercast import recovery as R
from water_cases import LAT, LON, cases, lake_relation

NOLIN = json.loads(R.BUNDLED_WATER.read_text())
CASES = {c["name"]: c for c in cases()}


def run(name):
    c = CASES[name]
    osm = R.parse_osm(c["elements"]) if c["elements"] is not None else None
    feats = R.merge_features(osm, R.bundled_water(*c["hit"], NOLIN) if c.get("bundled") else None)
    cells = R.search_grid(*c["hit"], c["yards"], c["run"])
    w = R.weight_cells(cells, c["yards"], c["run"], None, None, 0)
    fd = R.feature_distances(cells, *c["hit"], feats, c.get("marks", []))
    w = w * R.habitat_multiplier(fd, 1.2, 1.4)
    w = w / w.sum()
    mask = R.water_mask(cells, *c["hit"], feats)
    w2, removed = R.apply_water(w, cells, mask)
    return cells, w, mask, w2, removed, fd


def test_multipolygon_ways_join_into_rings_with_island():
    osm = R.parse_osm([lake_relation()])
    assert len(osm["lakes"]) == 1
    outer, island = osm["lakes"][0]
    assert outer[0] == outer[-1] and len(outer) == 7  # 3 ways (one reversed) → one closed ring
    assert island[0] == island[-1]
    assert len(osm["water"]) == 4  # every member way is shoreline for the 'head to water' pull


def test_assemble_rings_leaves_unclosable_chains_out():
    assert R.assemble_rings([[(0, 0), (0, 1)], [(0, 1), (1, 1)]]) == []


@pytest.mark.parametrize("name", [n for n in CASES])
def test_no_probability_in_open_water(name):
    cells, w, mask, w2, removed, _ = run(name)
    assert abs(w2.sum() - 1) < 1e-9
    for k, (wet, water_m) in enumerate(mask):
        if wet or water_m > R.SWIM_MAX_M:
            assert w2[k] == 0
    top = np.argsort(-w2)[:3]
    assert all(not mask[k][0] for k in top)


def test_facing_the_lake_piles_up_on_the_shore():
    cells, w, mask, w2, removed, _ = run("facing the lake")
    assert removed > R.REMOVED_NOTE
    k = int(np.argmax(w2))
    outward = [j for j, c in enumerate(cells) if c["sector"] == cells[k]["sector"] and c["ring"] == cells[k]["ring"] + 1]
    assert outward and mask[outward[0]][0], "best spot should be the last dry cell before the water"
    assert w2[k] > w[k] / w.sum() * 1.5


def test_far_bank_is_not_reached_by_swimming():
    cells, w, mask, w2, removed, _ = run("far bank across the water")
    far = [k for k, (wet, m) in enumerate(mask) if not wet and m > R.SWIM_MAX_M]
    assert far, "the grid should reach the far bank"
    assert all(w[k] > 0 and w2[k] == 0 for k in far)


def test_lake_behind_changes_nothing():
    _, w, mask, w2, removed, _ = run("lake behind")
    assert removed == 0 and np.allclose(w, w2)


def test_island_is_land():
    cells, w, mask, w2, removed, _ = run("on the island")
    near = [k for k, c in enumerate(cells) if c["ring"] == 0]
    assert all(not mask[k][0] and w2[k] > 0 for k in near)


def test_small_pond_is_run_around_and_stream_still_attracts():
    cells, w, mask, w2, removed, fd = run("stream + pond")
    past_pond = [k for k, (wet, m) in enumerate(mask) if not wet and m > 0]
    assert past_pond and all(w2[k] > 0 for k in past_pond)  # crossed < 50 m of pond: still reachable
    assert not any(m > R.SWIM_MAX_M for _, m in mask)
    hab = R.habitat_multiplier(fd, 1.2, 1.4)
    by_stream = [k for k, d in enumerate(fd) if d[0] < 20]
    assert by_stream and all(hab[k] > 1.5 for k in by_stream)  # streams + water marks stay attractors


def test_overpass_failed_uses_bundled_nolin():
    c = CASES["overpass failed - bundled Nolin"]
    assert R.bundled_water(*c["hit"]) is not None  # loads the bundled file by itself
    assert R.bundled_water(37.30, -85.90) is None  # far from Nolin
    cells, w, mask, w2, removed, _ = run(c["name"])
    assert removed > R.REMOVED_NOTE and sum(m[0] for m in mask) > 5
