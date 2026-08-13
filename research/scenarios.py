"""
Stress scenarios.

These are **assumptions, not measurements.** Each scenario is a hand-specified
shock in percent applied to individual positions, aggregated by weight. No
covariance matrix is estimated, because a year of daily data across six
currencies and a fund with three weeks of history cannot support one — a
correlation matrix built on that would look rigorous and be noise.

Sensitivities are attached at position level rather than bucket level, because
the buckets are not internally uniform: a grid bottleneck is good for a uranium
miner and bad for a neocloud, and both sit in Energy.

Every number below is a judgement. They are stated in one table so they can be
argued with, which is the point.
"""

from __future__ import annotations

from dataclasses import dataclass

from .ontology import Book, Entity


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


GRID_BOTTLENECK = Scenario(
    key="grid",
    name="Grid Bottleneck",
    premise=(
        "Interconnection queues and transformer lead times, not chips, become the "
        "binding constraint on new capacity. Announced data-centre build slips."
    ),
    shocks={
        # Owners of power and land capture scarcity rent.
        "URA": 18.0,
        "NLR": 12.0,
        "LB": 15.0,
        "PETR4.SA": 4.0,
        "2222.SR": 3.0,
        # The neoclouds are the losers: they have signed for capacity they
        # cannot energise, and their capex is already committed.
        "NBIS": -22.0,
        "CRWV": -28.0,
        # Compute demand is deferred, not destroyed.
        "TSM": -8.0,
        "AMD": -10.0,
        "2357.TW": -12.0,
        "^KS11": -7.0,
        "VGT": -6.0,
        "AINF.L": -9.0,
        "PLTR": -5.0,
        # Ballast roughly holds; rare earths bid on grid hardware demand.
        "GLD": 3.0,
        "RARA11.SA": 8.0,
        "JPM": -2.0,
        "AVDV": -1.0,
    },
    note="The thesis trade working: the bottleneck is physical, and the book is long the bottleneck.",
)

CAPEX_RETRENCHMENT = Scenario(
    key="capex",
    name="CapEx Retrenchment",
    premise=(
        "Hyperscalers cut AI capital spending guidance. The supercycle is "
        "re-rated as a cycle."
    ),
    shocks={
        "CRWV": -45.0,
        "NBIS": -40.0,
        "AMD": -30.0,
        "TSM": -25.0,
        "2357.TW": -28.0,
        "^KS11": -22.0,
        "AINF.L": -30.0,
        "VGT": -20.0,
        "PLTR": -32.0,
        # Fuel demand is a derivative of the buildout, so it goes too -- just
        # less, because reactors serve grids rather than data centres alone.
        "URA": -18.0,
        "NLR": -10.0,
        "LB": -20.0,
        "PETR4.SA": -8.0,
        "2222.SR": -6.0,
        # This is the scenario ballast exists for.
        "GLD": 8.0,
        "AVDV": -4.0,
        "JPM": -12.0,
        "RARA11.SA": -15.0,
    },
    note="The book's central risk. Note ballast is only 30% — it cushions, it does not rescue.",
)

GEOPOLITICAL_SHOCK = Scenario(
    key="geopolitics",
    name="Geopolitical Shock",
    premise=(
        "A Taiwan Strait escalation. Advanced foundry output is interrupted and "
        "export controls tighten on strategic materials."
    ),
    shocks={
        # Not a drawdown — an impairment. Three positions share one failure.
        "TSM": -45.0,
        "2357.TW": -50.0,
        "^KS11": -35.0,
        "AMD": -30.0,
        "VGT": -22.0,
        "AINF.L": -28.0,
        "NBIS": -25.0,
        "CRWV": -25.0,
        # Defence-adjacent software is the one compute line that can rise.
        "PLTR": 10.0,
        # Energy bids on supply fear; rare earths bid hard on export controls.
        "PETR4.SA": 12.0,
        "2222.SR": 14.0,
        "URA": 6.0,
        "NLR": 4.0,
        "LB": -5.0,
        "RARA11.SA": 35.0,
        "GLD": 18.0,
        "AVDV": -12.0,
        "JPM": -15.0,
    },
    note="Concentrated single-point risk: TSM, 2357.TW and ^KS11 are one bet, not three.",
)

SCENARIOS = {s.key: s for s in (GRID_BOTTLENECK, CAPEX_RETRENCHMENT, GEOPOLITICAL_SHOCK)}


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
    by_bucket = {}
    for entity in book.entities:
        by_bucket.setdefault(entity.bucket_label, 0.0)
        by_bucket[entity.bucket_label] += scenario.shock_for(entity) * entity.weight / 100.0

    return {
        "scenario": scenario,
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
