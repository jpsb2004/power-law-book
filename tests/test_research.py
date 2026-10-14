"""
Tests for the Python research layer. Run with `python -m pytest tests/`.

They build a small synthetic snapshot rather than reading data/snapshot.json,
so they do not depend on what the last refresh happened to fetch.
"""

from __future__ import annotations

import json

import pytest

from research.ontology import BUCKET_LABELS, BUCKET_ORDER, SchemaError, load_book
from research.scenarios import SCENARIOS, apply_scenario, combined


def _snapshot(tmp_path, positions):
    snap = {
        "asOf": 1_791_936_000_000,
        "base": "USD",
        "positions": positions,
        "curve": [{"t": 0, "c": 100.0}, {"t": 1, "c": 101.0}],
        "curveStats": {"ytd": 1.0},
        "fx": {"USD": {"rate": 1}},
    }
    path = tmp_path / "snapshot.json"
    path.write_text(json.dumps(snap), encoding="utf-8")
    return path


def _pos(ticker, sleeve, weight):
    return {"ticker": ticker, "name": ticker, "sleeve": sleeve, "currency": "USD", "weight": weight, "venue": "X"}


@pytest.fixture
def book(tmp_path):
    # Roster order deliberately differs from display order: Ballast first.
    return load_book(_snapshot(tmp_path, [
        _pos("GLD", "ballast", 25),
        _pos("URA", "energy", 38),
        _pos("TSM", "compute", 32),
        _pos("RARA11.SA", "materials", 5),
    ]))


def test_four_buckets_in_display_order():
    assert BUCKET_ORDER == ("energy", "compute", "materials", "ballast")
    assert set(BUCKET_LABELS) == set(BUCKET_ORDER)


def test_bucket_weights(book):
    assert {k: book.bucket_weight(k) for k in BUCKET_ORDER} == {
        "energy": 38, "compute": 32, "materials": 5, "ballast": 25,
    }


def test_scenario_buckets_follow_display_order_not_roster_order(book):
    result = apply_scenario(book, SCENARIOS["grid"])
    assert list(result["by_bucket"]) == ["Energy", "Compute", "Materials", "Ballast"]


def test_scenario_contribution_is_shock_times_weight(book):
    result = apply_scenario(book, SCENARIOS["geopolitics"])
    shocks = SCENARIOS["geopolitics"].shocks
    expected = sum(shocks.get(t, 0.0) * w / 100 for t, w in
                   (("GLD", 25), ("URA", 38), ("TSM", 32), ("RARA11.SA", 5)))
    assert result["portfolio_pct"] == pytest.approx(expected)
    assert result["by_bucket"]["Materials"] == pytest.approx(shocks["RARA11.SA"] * 5 / 100)


def test_capex_note_reads_ballast_from_live_weights(book):
    assert "ballast is only 25%" in apply_scenario(book, SCENARIOS["capex"])["note"]


def test_combined_note_has_no_unfilled_placeholders(book):
    note = combined(book, ["grid", "capex"])["note"]
    assert "{" not in note


def test_unknown_bucket_is_rejected(tmp_path):
    with pytest.raises(SchemaError):
        load_book(_snapshot(tmp_path, [_pos("A", "energy", 50), _pos("B", "crypto", 50)]))
