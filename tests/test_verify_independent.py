"""Independent verification: date alignment, final-bar rescue, status and exit codes.

Fixture series only; nothing here touches the network or the committed
data/verification.json (main() writes into tmp_path).
"""

from __future__ import annotations

import importlib.util
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "verify_independent", Path(__file__).resolve().parents[1] / "scripts" / "verify_independent.py"
)
vi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vi)


def _series(end: str, n: int = 260, start: float = 100.0):
    """Weekday closes ending on `end`, with a gentle wobble so volatility is not zero."""
    days, d = [], date.fromisoformat(end)
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d -= timedelta(days=1)
    days.reverse()
    return [(x, start * (1 + 0.001 * i) * (1.01 if i % 3 else 0.99)) for i, x in enumerate(days)]


def _ts(day: str, hour: int = 20) -> int:
    return int(datetime.fromisoformat(day).replace(hour=hour, tzinfo=timezone.utc).timestamp())


def _res(series, *, null_last=False, quote=None, quote_day=None):
    closes = [c for _, c in series]
    if null_last:
        closes[-1] = None
    meta = {"gmtoffset": 0}
    if quote is not None:
        meta.update(regularMarketPrice=quote, regularMarketTime=_ts(quote_day))
    return {
        "meta": meta,
        "timestamp": [_ts(d) for d, _ in series],
        "indicators": {"adjclose": [{"adjclose": closes}], "quote": [{"close": closes}]},
    }


NOW = _ts("2026-10-27", 6)  # after every session in the fixtures has closed


# --- final-bar rescue ----------------------------------------------------------

def test_null_final_bar_is_rescued_from_same_day_quote():
    s = _series("2026-10-26")
    out = vi.parse_chart(_res(s, null_last=True, quote=123.45, quote_day="2026-10-26"), NOW)
    assert out[-1] == ("2026-10-26", 123.45)
    assert len(out) == len(s)


def test_null_final_bar_with_stale_quote_is_dropped_not_carried():
    s = _series("2026-10-26")
    out = vi.parse_chart(_res(s, null_last=True, quote=123.45, quote_day="2026-10-23"), NOW)
    assert out[-1][0] == "2026-10-23"
    assert len(out) == len(s) - 1


def test_mid_series_null_is_not_rescued():
    s = _series("2026-10-26")
    res = _res(s, quote=999.0, quote_day="2026-10-26")
    res["indicators"]["adjclose"][0]["adjclose"][-5] = None
    out = vi.parse_chart(res, NOW)
    assert 999.0 not in [c for _, c in out[:-1]]
    assert len(out) == len(s) - 1


# --- alignment and status ------------------------------------------------------

def test_series_missing_last_bar_is_not_comparable():
    s, why = vi.align(_series("2026-10-23"), "2026-10-26")
    assert s is None and "2026-10-26" in why


def test_series_is_truncated_at_last_bar():
    s, why = vi.align(_series("2026-10-27"), "2026-10-26")
    assert why is None and s[-1][0] == "2026-10-26"


def test_status_pass_fail_and_ordering():
    assert vi.row_status({"ytd": 0.0001, "ret1y": -0.0002, "vol": 0.049}) == "pass"
    assert vi.row_status({"ytd": 1.0, "ret1y": 0.0, "vol": 0.0}) == "fail"
    rows = lambda *s: [{"status": x} for x in s]
    assert vi.overall(rows("pass", "pass")) == "pass"
    assert vi.overall(rows("pass", "not comparable")) == "not comparable"
    assert vi.overall(rows("not comparable", "fail", "pass")) == "fail"


# --- main(): files and exit codes ----------------------------------------------

def _run(tmp_path, series_by_symbol, pipeline_by_ticker, last_bar="2026-10-26"):
    (tmp_path / "data").mkdir()
    (tmp_path / "research").mkdir()
    snap = {
        "asOf": NOW * 1000,
        "positions": [{"ticker": t, "lastBar": last_bar, "usd": u} for t, u in pipeline_by_ticker.items()],
    }
    (tmp_path / "data" / "snapshot.json").write_text(json.dumps(snap), encoding="utf-8")
    code = vi.main(fetch=lambda sym: series_by_symbol[sym], root=tmp_path)
    out = tmp_path / "data" / "verification.json"
    return code, (json.loads(out.read_text(encoding="utf-8")) if out.exists() else None)


def _fixtures(end="2026-10-26"):
    s = {"AMD": _series(end), "PETR4.SA": _series(end, start=30), "USDBRL=X": _series(end, start=5), "GLD": _series(end, start=200)}
    usd = {
        "AMD": vi.stats(s["AMD"]),
        "PETR4.SA": vi.stats(vi.to_usd(s["PETR4.SA"], s["USDBRL=X"])),
        "GLD": vi.stats(s["GLD"]),
    }
    return s, usd


def test_equal_series_pass_and_exit_0(tmp_path):
    s, usd = _fixtures()
    code, v = _run(tmp_path, s, usd)
    assert code == 0 and v["status"] == "pass"
    assert all(r["status"] == "pass" for r in v["rows"])
    assert v["maxAbsDiffPp"] < vi.TOL_PP
    assert (tmp_path / "research" / "verification.xlsx").exists()


def test_one_percent_gap_fails_and_exits_3(tmp_path):
    s, usd = _fixtures()
    usd["GLD"] = {**usd["GLD"], "ytd": usd["GLD"]["ytd"] + 1.0}
    code, v = _run(tmp_path, s, usd)
    assert code == 3 and v["status"] == "fail"
    assert {r["ticker"]: r["status"] for r in v["rows"]}["GLD"] == "fail"


def test_27_oct_scenario_is_not_comparable_never_a_fail(tmp_path):
    # 27 Oct 2026: Yahoo's final AMD and GLD bars were null with no same-day
    # quote, so the independent series ended Fri 23 Oct while the pipeline
    # ended Mon 26 Oct (AMD moved +2.8% that day: the whole 6.48pp "gap").
    s, usd = _fixtures()
    usd["AMD"] = {**usd["AMD"], "ytd": usd["AMD"]["ytd"] + 6.48}
    s["AMD"] = vi.parse_chart(_res(s["AMD"], null_last=True), NOW)
    s["GLD"] = vi.parse_chart(_res(s["GLD"], null_last=True), NOW)
    code, v = _run(tmp_path, s, usd)
    by = {r["ticker"]: r for r in v["rows"]}
    assert code == 0 and v["status"] == "not comparable"
    assert by["AMD"]["status"] == "not comparable" and by["AMD"]["diffPp"] is None
    assert by["PETR4.SA"]["status"] == "pass"


def test_27_oct_scenario_with_same_day_quote_is_rescued_and_passes(tmp_path):
    s, usd = _fixtures()
    last = s["AMD"][-1][1]
    s["AMD"] = vi.parse_chart(_res(s["AMD"], null_last=True, quote=last, quote_day="2026-10-26"), NOW)
    code, v = _run(tmp_path, s, usd)
    assert code == 0 and v["status"] == "pass"


def test_fetch_error_exits_4_and_writes_nothing(tmp_path):
    s, usd = _fixtures()

    def boom(sym):
        raise vi.FetchError(sym)

    (tmp_path / "data").mkdir()
    (tmp_path / "research").mkdir()
    snap = {"asOf": NOW * 1000, "positions": [{"ticker": t, "lastBar": "2026-10-26", "usd": u} for t, u in usd.items()]}
    (tmp_path / "data" / "snapshot.json").write_text(json.dumps(snap), encoding="utf-8")
    assert vi.main(fetch=boom, root=tmp_path) == 4
    assert not (tmp_path / "data" / "verification.json").exists()
    assert not (tmp_path / "research" / "verification.xlsx").exists()


def test_malformed_chart_json_is_a_fetch_error(monkeypatch):
    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, *a):
            return b'{"chart": {"result": null}}'

    monkeypatch.setattr(vi.urllib.request, "urlopen", lambda *a, **k: Resp())
    with pytest.raises(vi.FetchError):
        vi.chart("AMD")
