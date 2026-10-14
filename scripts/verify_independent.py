"""
Independent recomputation of three positions (review item P2, reproducibility).

    python scripts/verify_independent.py

Re-derives YTD return, one-year return and annualised volatility in USD for
AMD (a US equity), PETR4.SA (a Brazilian equity, so the FX conversion is
tested too) and GLD (a fund), from Yahoo's raw chart data fetched here with the
standard library -- none of the Node pipeline's code is used -- and compares
them with data/snapshot.json.

It writes two files:
  research/verification.xlsx  one sheet per position with the raw closes, the
                              FX rate, and Excel formulas that recompute the
                              three figures, so the check can be redone in a
                              spreadsheet without trusting this script either;
  data/verification.json      the comparison, read by the README and the page.

Run it right after a refresh so both sides see the same closes.
"""

from __future__ import annotations

import json
import math
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

ROOT = Path(__file__).resolve().parents[1]
LINES = [("AMD", None), ("PETR4.SA", "USDBRL=X"), ("GLD", None)]
UA = {"User-Agent": "Mozilla/5.0 (verify_independent; power-law-book)"}


def chart(symbol: str) -> list[tuple[str, float]]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1y&interval=1d"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        res = json.load(r)["chart"]["result"][0]
    adj = (res["indicators"].get("adjclose") or [{}])[0].get("adjclose") or res["indicators"]["quote"][0]["close"]
    off = res["meta"].get("gmtoffset", 0)
    regular = res["meta"].get("currentTradingPeriod", {}).get("regular", {})
    now = datetime.now(timezone.utc).timestamp()
    out = []
    for t, c in zip(res["timestamp"], adj):
        if c is None:
            continue
        out.append((datetime.fromtimestamp(t + off, timezone.utc).strftime("%Y-%m-%d"), float(c)))
    # Same rule as the pipeline: a session still open is not a close.
    if regular and regular["start"] <= now < regular["end"] and out:
        today = datetime.fromtimestamp(now + off, timezone.utc).strftime("%Y-%m-%d")
        if out[-1][0] == today:
            out.pop()
    return out


def to_usd(local, fx):
    if fx is None:
        return [(d, c) for d, c in local]
    out, i, rate = [], 0, fx[0][1]
    for d, c in local:
        while i < len(fx) and fx[i][0] <= d:
            rate = fx[i][1]
            i += 1
        out.append((d, c / rate))
    return out


def stats(usd):
    last_d, last_c = usd[-1]
    jan1 = last_d[:4] + "-01-01"
    ytd_base = next(c for d, c in usd if d >= jan1)
    cut = (datetime.fromisoformat(last_d) - timedelta(days=365)).strftime("%Y-%m-%d")
    y_base = next(c for d, c in usd if d >= cut)
    rets = [math.log(usd[i][1] / usd[i - 1][1]) for i in range(1, len(usd))]
    m = sum(rets) / len(rets)
    sd = math.sqrt(sum((r - m) ** 2 for r in rets) / (len(rets) - 1))
    years = (datetime.fromisoformat(last_d) - datetime.fromisoformat(usd[0][0])).days / 365.25
    ppy = (len(usd) - 1) / years if years > 0.25 else 252
    return {
        "ytd": (last_c / ytd_base - 1) * 100,
        "ret1y": (last_c / y_base - 1) * 100,
        "vol": sd * math.sqrt(ppy) * 100,
        "ytdBaseDate": next(d for d, _ in usd if d >= jan1),
        "yBaseDate": next(d for d, _ in usd if d >= cut),
        "ppy": ppy,
    }


def main() -> None:
    snap = json.loads((ROOT / "data" / "snapshot.json").read_text(encoding="utf-8"))
    by = {p["ticker"]: p for p in snap["positions"]}
    wb = Workbook()
    wb.remove(wb.active)
    rows = []
    for ticker, pair in LINES:
        local = chart(ticker)
        fx = chart(pair) if pair else None
        usd = to_usd(local, fx)
        mine = stats(usd)
        theirs = by[ticker]["usd"]
        rows.append({
            "ticker": ticker,
            "independent": {k: round(mine[k], 4) for k in ("ytd", "ret1y", "vol")},
            "pipeline": {k: round(theirs[k], 4) for k in ("ytd", "ret1y", "vol")},
            "diffPp": {k: round(mine[k] - theirs[k], 4) for k in ("ytd", "ret1y", "vol")},
            "lastClose": usd[-1][0],
        })

        # The spreadsheet: values in, formulas out.
        ws = wb.create_sheet(ticker.replace(".", "_"))
        ws.append(["date", "local close (total return)", "USD per local" if pair else "FX", "USD close", "log return"])
        for c in ws[1]:
            c.font = Font(bold=True)
        fxmap = dict(fx) if fx else {}
        last_rate = fx[0][1] if fx else 1.0
        for i, (d, c) in enumerate(local, start=2):
            if fx:
                last_rate = max(((fd, r) for fd, r in fx if fd <= d), default=(None, last_rate))[1]
            ws.append([d, c, last_rate if fx else 1])
            ws.cell(row=i, column=4, value=f"=B{i}/C{i}")
            if i > 2:
                ws.cell(row=i, column=5, value=f"=LN(D{i}/D{i-1})")
        n = len(local) + 1
        dates = [d for d, _ in local]
        ytd_row = dates.index(mine["ytdBaseDate"]) + 2
        y_row = dates.index(mine["yBaseDate"]) + 2
        ws["G1"], ws["H1"] = "measure", "Excel"
        ws["G2"], ws["H2"] = "YTD %", f"=(D{n}/D{ytd_row}-1)*100"
        ws["G3"], ws["H3"] = "1-year %", f"=(D{n}/D{y_row}-1)*100"
        ws["G4"], ws["H4"] = "observations per year", f"=(COUNT(D2:D{n})-1)/((DATEVALUE(A{n})-DATEVALUE(A2))/365.25)"
        ws["G5"], ws["H5"] = "volatility %", f"=STDEV.S(E3:E{n})*SQRT(H4)*100"
        ws["G7"], ws["H7"] = "pipeline YTD %", theirs["ytd"]
        ws["G8"], ws["H8"] = "pipeline 1-year %", theirs["ret1y"]
        ws["G9"], ws["H9"] = "pipeline volatility %", theirs["vol"]
        ws["G11"] = "Snapshot as of " + datetime.fromtimestamp(snap["asOf"] / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        for col, w in (("A", 12), ("B", 22), ("C", 14), ("D", 14), ("E", 12), ("G", 26), ("H", 14)):
            ws.column_dimensions[col].width = w

    out = ROOT / "research" / "verification.xlsx"
    wb.save(out)
    worst = max(abs(v) for r in rows for v in r["diffPp"].values())
    result = {
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "snapshotAsOf": datetime.fromtimestamp(snap["asOf"] / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "method": "standard-library fetch of Yahoo chart data; FX applied by date; YTD, 1y, vol recomputed in Python and as Excel formulas",
        "rows": rows,
        "maxAbsDiffPp": worst,
    }
    (ROOT / "data" / "verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    for r in rows:
        print(r["ticker"], "independent", r["independent"], "pipeline", r["pipeline"], "diff", r["diffPp"])
    print(f"max abs difference {worst:.4f}pp -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
