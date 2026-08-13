"""
The ontology: raw feeds mapped onto asset entities, with lineage.

Every fact this project displays is attached to an *entity* (a position) and
carries a *source* saying where it came from and when. Nothing floats free. The
dashboard and the briefing both read entities from here rather than touching
raw files, so there is exactly one definition of "what we know about CRWV".

Market data is not fetched in Python. `data/snapshot.json` is produced by the
Node pipeline, which owns prices, FX conversion and deviation maths; this module
loads and validates that artifact. Reimplementing the maths here would create a
second version that silently disagrees with the published page.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data" / "snapshot.json"

# Fields the snapshot contract guarantees. If the Node side stops emitting one,
# this fails loudly here rather than rendering a dashboard full of blanks.
REQUIRED_POSITION_FIELDS = ("ticker", "name", "sleeve", "currency", "weight", "venue")
REQUIRED_SNAPSHOT_FIELDS = ("asOf", "base", "positions", "curve", "curveStats", "fx")

BUCKET_ORDER = ("energy", "compute", "ballast")
BUCKET_LABELS = {"energy": "Energy", "compute": "Compute", "ballast": "Ballast"}


class SchemaError(ValueError):
    """The snapshot does not match the contract this layer relies on."""


@dataclass(frozen=True)
class Source:
    """Provenance for one fact. Lineage is not optional here."""

    origin: str  # "yahoo-chart-v8", "google-news-rss", "sec-edgar-atom", "cvm-atom"
    retrieved_at: datetime
    ref: str = ""  # url or symbol the fact came from

    def label(self) -> str:
        return f"{self.origin} · {self.retrieved_at:%Y-%m-%d %H:%M UTC}"


@dataclass
class NewsItem:
    title: str
    link: str
    published: datetime | None
    source_name: str
    origin: str  # which feed family produced it

    def age_hours(self, now: datetime | None = None) -> float | None:
        if self.published is None:
            return None
        now = now or datetime.now(timezone.utc)
        return (now - self.published).total_seconds() / 3600


@dataclass
class Entity:
    """One position, and everything the system knows about it."""

    ticker: str
    name: str
    bucket: str
    weight: float
    currency: str
    venue: str
    kind: str = ""
    thesis: str = ""
    breaks: str = ""

    price: float | None = None
    price_usd: float | None = None
    previous_close: float | None = None

    # Deviation block, computed in lib/analytics.js and carried through as-is.
    day_return_pct: float | None = None
    sigma: float | None = None
    from_mean_pct: float | None = None
    from_high_pct: float | None = None
    volume_ratio: float | None = None

    ytd_usd: float | None = None
    ret1y_usd: float | None = None
    vol_usd: float | None = None
    max_drawdown_usd: float | None = None

    coverage: float | None = None
    partial: bool = False
    fx_missing: bool = False
    error: str | None = None

    news: list[NewsItem] = field(default_factory=list)
    sources: list[Source] = field(default_factory=list)

    @property
    def bucket_label(self) -> str:
        return BUCKET_LABELS.get(self.bucket, self.bucket.title())

    @property
    def is_alerting(self) -> bool:
        """A move worth a human looking at it."""
        return self.sigma is not None and abs(self.sigma) >= 2.0

    def alert_reason(self) -> str | None:
        if self.error:
            return f"no quote: {self.error}"
        if self.fx_missing:
            return "no FX conversion available"
        if self.is_alerting:
            direction = "up" if (self.sigma or 0) > 0 else "down"
            return f"{abs(self.sigma):.1f}σ {direction} on the day"
        return None


@dataclass
class Book:
    as_of: datetime
    base: str
    entities: list[Entity]
    curve: list[dict[str, Any]]
    curve_stats: dict[str, Any]
    fx: dict[str, Any]
    source: Source

    def by_bucket(self, bucket: str) -> list[Entity]:
        return [e for e in self.entities if e.bucket == bucket]

    def bucket_weight(self, bucket: str) -> float:
        return sum(e.weight for e in self.by_bucket(bucket))

    def alerts(self) -> list[Entity]:
        ranked = [e for e in self.entities if e.alert_reason()]
        return sorted(ranked, key=lambda e: abs(e.sigma or 0), reverse=True)

    @property
    def index_level(self) -> float | None:
        return self.curve[-1]["c"] if self.curve else None


def _require(mapping: dict[str, Any], fields: Iterable[str], where: str) -> None:
    missing = [f for f in fields if f not in mapping]
    if missing:
        raise SchemaError(f"{where} is missing required field(s): {', '.join(missing)}")


def load_book(path: Path | None = None) -> Book:
    """Load and validate the snapshot into entities."""
    path = path or SNAPSHOT
    if not path.exists():
        raise SchemaError(
            f"{path} not found. Run `npm run refresh` first — the Node pipeline "
            "owns market data and writes this file."
        )

    raw = json.loads(path.read_text(encoding="utf-8"))
    _require(raw, REQUIRED_SNAPSHOT_FIELDS, "snapshot.json")

    retrieved = datetime.fromtimestamp(raw["asOf"] / 1000, tz=timezone.utc)
    source = Source("yahoo-chart-v8", retrieved, raw.get("source", ""))

    entities: list[Entity] = []
    for pos in raw["positions"]:
        _require(pos, REQUIRED_POSITION_FIELDS, f"position {pos.get('ticker', '?')}")

        dev = pos.get("dev") or {}
        usd = pos.get("usd") or {}
        entities.append(
            Entity(
                ticker=pos["ticker"],
                name=pos["name"],
                bucket=pos["sleeve"],
                weight=float(pos["weight"]),
                currency=pos["currency"],
                venue=pos["venue"],
                kind=pos.get("kind", ""),
                thesis=pos.get("thesis", ""),
                breaks=pos.get("breaks", ""),
                price=pos.get("price"),
                price_usd=pos.get("priceUsd"),
                previous_close=pos.get("previousClose"),
                day_return_pct=dev.get("dayReturnPct"),
                sigma=dev.get("sigma"),
                from_mean_pct=dev.get("fromMeanPct"),
                from_high_pct=dev.get("fromHighPct"),
                volume_ratio=dev.get("volumeRatio"),
                ytd_usd=usd.get("ytd"),
                ret1y_usd=usd.get("ret1y"),
                vol_usd=usd.get("vol"),
                max_drawdown_usd=usd.get("maxDrawdown"),
                coverage=pos.get("coverage"),
                partial=bool(pos.get("partial")),
                fx_missing=bool(pos.get("fxMissing")),
                error=pos.get("error"),
                sources=[source],
            )
        )

    if not entities:
        raise SchemaError("snapshot contains no positions")

    total = round(sum(e.weight for e in entities), 6)
    if abs(total - 100) > 0.5:
        raise SchemaError(f"weights total {total}%, expected 100%")

    unknown = {e.bucket for e in entities} - set(BUCKET_ORDER)
    if unknown:
        raise SchemaError(f"unknown bucket(s) in snapshot: {', '.join(sorted(unknown))}")

    return Book(
        as_of=retrieved,
        base=raw["base"],
        entities=entities,
        curve=raw["curve"],
        curve_stats=raw["curveStats"],
        fx=raw["fx"],
        source=source,
    )
