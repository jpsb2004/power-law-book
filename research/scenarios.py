"""
Stress scenarios.

These are **assumptions, not measurements.** Each scenario is a hand-specified
shock in percent applied to individual positions, aggregated by weight. No
covariance matrix is estimated, because a year of daily data across several
currencies and a fund with a few months of history cannot support one — a
correlation matrix built on that would look rigorous and be noise.

Sensitivities are attached at position level rather than bucket level, because
the buckets are not internally uniform: a grid bottleneck is good for a uranium
miner and bad for a neocloud, and both sit in Energy.

Every number is a judgement. They are stated in one table, data/scenarios.json,
so they can be argued with, which is the point.

The Korea line's shocks were set for ^KS11 and carried over unchanged when the
book swapped it for EWY (14 Oct 2026). EWY is in dollars, so a won move now
lands inside the shock; revisit them rather than reading them as re-estimated.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .ontology import BUCKET_LABELS, BUCKET_ORDER, Book, Entity


@dataclass(frozen=True)
class Scenario:
    key: str
    name: str
    premise: str
    # ticker -> shock in percent. Anything unlisted is treated as 0.
    shocks: dict[str, float]
    note: str

    def shock_for(self, entity: Entity) -> float:
        return self.shocks.get(entity.ticker, 0.0)


# The shocks live in data/scenarios.json so the Node pipeline (published page)
# and this module (dashboard, PDF, daily note) read one table. Each scenario
# carries its rationale there.
_DATA = json.loads((Path(__file__).resolve().parents[1] / "data" / "scenarios.json").read_text(encoding="utf-8"))
SCENARIOS = {
    s["key"]: Scenario(key=s["key"], name=s["name"], premise=s["premise"], shocks=s["shocks"], note=s["note"])
    for s in _DATA["scenarios"]
}
GRID_BOTTLENECK = SCENARIOS["grid"]
CAPEX_RETRENCHMENT = SCENARIOS["capex"]
GEOPOLITICAL_SHOCK = SCENARIOS["geopolitics"]


def apply_scenario(book: Book, scenario: Scenario) -> dict:
    """
    Weight-aggregate a scenario across the book.

    Returns portfolio impact plus per-position contribution, so the dashboard can
    show which lines drive the number rather than only the total.
    """
    rows = []
    total = 0.0
    for entity in book.entities:
        shock = scenario.shock_for(entity)
        contribution = shock * entity.weight / 100.0
        total += contribution
        rows.append(
            {
                "ticker": entity.ticker,
                "name": entity.name,
                "bucket": entity.bucket_label,
                "weight": entity.weight,
                "shock_pct": shock,
                "contribution_pct": contribution,
            }
        )

    rows.sort(key=lambda r: r["contribution_pct"])
    # Seeded in display order, so every renderer lists buckets the same way
    # regardless of the order positions appear in the roster.
    by_bucket = {BUCKET_LABELS[k]: 0.0 for k in BUCKET_ORDER if book.by_bucket(k)}
    for entity in book.entities:
        by_bucket.setdefault(entity.bucket_label, 0.0)
        by_bucket[entity.bucket_label] += scenario.shock_for(entity) * entity.weight / 100.0

    return {
        "scenario": scenario,
        # The note with any live figures filled in; renderers show this, not
        # `scenario.note`, which may carry placeholders.
        "note": scenario.note.format(ballast=book.bucket_weight("ballast")),
        "portfolio_pct": total,
        "by_bucket": by_bucket,
        "rows": rows,
        "worst": rows[:5],
        "best": list(reversed(rows[-5:])),
    }


def combined(book: Book, keys: list[str]) -> dict | None:
    """
    Several scenarios at once, shocks summed.

    Summing assumes the scenarios are independent, which they are not — a grid
    bottleneck makes capex retrenchment more likely, not less. Treat a combined
    figure as an ordering of severity, not a probability-weighted forecast.
    """
    chosen = [SCENARIOS[k] for k in keys if k in SCENARIOS]
    if not chosen:
        return None
    if len(chosen) == 1:
        return apply_scenario(book, chosen[0])

    merged: dict[str, float] = {}
    for scenario in chosen:
        for ticker, shock in scenario.shocks.items():
            merged[ticker] = merged.get(ticker, 0.0) + shock

    synthetic = Scenario(
        key="+".join(s.key for s in chosen),
        name=" + ".join(s.name for s in chosen),
        premise="Simultaneous: " + " ".join(s.premise for s in chosen),
        shocks=merged,
        note=(
            "Shocks are summed and the scenarios are not independent — read this "
            "as an ordering of severity, not a forecast."
        ),
    )
    return apply_scenario(book, synthetic)
