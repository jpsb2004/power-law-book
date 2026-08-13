"""
Briefing synthesis: orchestrator-worker over the day's deviations and feeds.

Shape of the chain:

  workers       one per position that is actually interesting (a >=2σ move, a
                fresh filing, a data-quality flag). Each condenses that
                position's headlines into two or three sentences, seeing only
                its own entity -- a bounded context per call, so 18 positions
                never collide in one prompt.
  orchestrator  receives the worker notes plus book-level aggregates and writes
                the note. It is the only call that sees the whole book.

Why filter before summarising: on a quiet day most positions have nothing to
say, and asking a model to summarise eighteen streams of nothing produces
eighteen paragraphs of nothing. The filter is deviation-based and runs before
any model call, so a quiet day is cheap.

No API key? `render_deterministic()` writes the same note structure from the
data alone. The pipeline must never fail because a secret is absent, and CI
without a key should still produce a real artifact.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from .ontology import Book, Entity
from .scenarios import SCENARIOS, apply_scenario

MODEL = "claude-sonnet-5"
SIGMA_ALERT = 2.0
MAX_WORKERS = 6

HOUSE_STYLE = (
    "You are writing for an institutional equity research daily note. Use the "
    "vocabulary of the sector: grid interconnection queues, capex cycles, supply "
    "squeezes, utilisation, backlog, offtake, lead times. Be specific and "
    "declarative. No hedging filler, no bullet-point padding, no restating the "
    "prompt. Never invent a number that is not given to you."
)


def _client():
    """Anthropic client, or None when no key is configured."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        from anthropic import Anthropic
    except ImportError:
        return None
    return Anthropic(api_key=key)


def select_signals(book: Book, limit: int = MAX_WORKERS) -> list[Entity]:
    """
    Which positions earn a worker call.

    Ranked by absolute sigma, with data-quality problems promoted: a position
    that failed to price is more newsworthy than one that moved 1%.
    """

    def rank(e: Entity) -> float:
        if e.error or e.fx_missing:
            return 99.0
        return abs(e.sigma or 0.0)

    candidates = [e for e in book.entities if rank(e) >= SIGMA_ALERT or e.error or e.fx_missing]
    if not candidates:
        # Quiet day: still show the largest movers so the note is not empty.
        candidates = sorted(book.entities, key=rank, reverse=True)[:3]
    return sorted(candidates, key=rank, reverse=True)[:limit]


def _entity_brief(entity: Entity) -> str:
    """Compact, factual context for one position. No interpretation added."""
    bits = [
        f"{entity.ticker} ({entity.name}) — {entity.bucket_label} bucket, "
        f"{entity.weight}% of book, listed {entity.venue} in {entity.currency}."
    ]
    if entity.day_return_pct is not None:
        bits.append(
            f"Day move {entity.day_return_pct:+.1f}%"
            + (f" ({entity.sigma:+.1f} sigma vs its own trailing distribution)." if entity.sigma is not None else ".")
        )
    if entity.volume_ratio is not None:
        bits.append(f"Volume {entity.volume_ratio:.2f}x its 50-day average.")
    if entity.from_high_pct is not None:
        bits.append(f"{entity.from_high_pct:+.1f}% versus its 12-month high.")
    if entity.ytd_usd is not None:
        bits.append(f"YTD in USD {entity.ytd_usd:+.1f}%.")
    if entity.partial:
        bits.append(
            f"DATA CAVEAT: only {100 * (entity.coverage or 0):.0f}% of the measured "
            "window — a recent listing, so longer-horizon figures exclude it."
        )
    if entity.fx_missing:
        bits.append("DATA CAVEAT: no FX conversion available; USD figures omitted.")
    if entity.error:
        bits.append(f"DATA CAVEAT: quote failed ({entity.error}).")
    bits.append(f"Standing thesis: {entity.thesis}")
    bits.append(f"Stated falsification: {entity.breaks}")

    if entity.news:
        bits.append("Headlines:")
        for item in entity.news[:6]:
            age = item.age_hours()
            stamp = f" [{age:.0f}h ago]" if age is not None and age < 240 else ""
            bits.append(f"  - ({item.origin}) {item.title}{stamp} — {item.source_name}")
    else:
        bits.append("Headlines: none retrieved.")
    return "\n".join(bits)


def run_worker(client, entity: Entity) -> str:
    """Condense one position's day. Falls back to a factual line on failure."""
    if client is None:
        return _deterministic_worker(entity)

    prompt = (
        f"{HOUSE_STYLE}\n\n"
        "Below is one position from a global macro book on AI infrastructure "
        "bottlenecks. Write 2-3 sentences on what happened and whether it speaks "
        "to the standing thesis or the stated falsification. If the headlines do "
        "not explain the move, say the move is unexplained by available sources "
        "rather than inventing a cause. Respect any DATA CAVEAT.\n\n"
        f"{_entity_brief(entity)}"
    )
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=350,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception as exc:  # noqa: BLE001 - a failed worker must not kill the run
        return _deterministic_worker(entity) + f"\n\n_(model call failed: {exc})_"


def _deterministic_worker(entity: Entity) -> str:
    move = (
        f"{entity.day_return_pct:+.1f}%" if entity.day_return_pct is not None else "no quoted move"
    )
    sigma = f" ({entity.sigma:+.1f}σ)" if entity.sigma is not None else ""
    lead = f"**{entity.ticker}** {move}{sigma}."
    if entity.error:
        lead = f"**{entity.ticker}** failed to price: {entity.error}."
    elif entity.fx_missing:
        lead = f"**{entity.ticker}** has no FX conversion; USD figures omitted."

    vol = (
        f" Volume ran {entity.volume_ratio:.2f}x its 50-day average."
        if entity.volume_ratio is not None
        else ""
    )
    # Prefer a descriptive headline over a filing stub: an EDGAR title says a
    # document exists, not what moved the price.
    editorial = next((n for n in entity.news if n.origin == "google-news-rss"), None)
    lead_item = editorial or (entity.news[0] if entity.news else None)
    cite = (
        f' Most recent headline: "{lead_item.title}" ({lead_item.source_name}).'
        if lead_item
        else " No headlines retrieved."
    )
    filings = [n for n in entity.news if n.origin == "sec-edgar-atom"]
    if filings:
        cite += f" {len(filings)} recent EDGAR filing(s)."
    return f"{lead}{vol}{cite} Falsification on watch: {entity.breaks}"


def _book_context(book: Book) -> str:
    stats = book.curve_stats
    lines = [
        f"Book: {len(book.entities)} positions, base {book.base}, "
        f"as of {book.as_of:%Y-%m-%d %H:%M UTC}.",
        "Buckets: "
        + ", ".join(
            f"{label} {book.bucket_weight(key):.0f}%"
            for key, label in (("energy", "Energy"), ("compute", "Compute"), ("ballast", "Ballast"))
        ),
    ]
    if book.index_level is not None:
        lines.append(f"Index level {book.index_level:.2f} (rebased to 100 twelve months ago).")
    for key, label in (("ytd", "YTD"), ("ret1y", "1-year"), ("vol", "annualised vol"), ("maxDrawdown", "max drawdown")):
        value = stats.get(key)
        if value is not None:
            lines.append(f"{label}: {value:+.1f}%")

    partial = [e for e in book.entities if e.partial]
    if partial:
        lines.append(
            "Coverage caveat: "
            + "; ".join(f"{e.ticker} {100 * (e.coverage or 0):.0f}% of window" for e in partial)
            + ". Longer-horizon figures therefore exclude these for most of the period."
        )
    return "\n".join(lines)


def build(book: Book, scenario_key: str = "grid") -> str:
    """Produce the ER daily note."""
    client = _client()
    signals = select_signals(book)
    notes = [(e, run_worker(client, e)) for e in signals]

    scenario = apply_scenario(book, SCENARIOS[scenario_key])
    header = _render_header(book, scenario)

    if client is None:
        return header + render_deterministic(book, notes, scenario)

    worker_block = "\n\n".join(f"### {e.ticker}\n{text}" for e, text in notes)
    prompt = (
        f"{HOUSE_STYLE}\n\n"
        "You are the orchestrator writing today's daily note for a thesis titled "
        '"Beyond the Hyper-Scalers: Quantifying Physical Bottlenecks of the Global '
        'AI CapEx Supercycle". The thesis: computation demand is growing faster '
        "than the physical systems that feed it — fuel, molecules, land and grid — "
        "can be rebuilt.\n\n"
        "Write markdown with exactly these sections:\n"
        "## Summary — three sentences on what today means for the thesis.\n"
        "## Signals — the notable moves, grouped by bucket, referencing the analyst notes.\n"
        "## Thesis check — does today support or undercut the bottleneck thesis? Be willing to say it undercuts it.\n"
        "## Watch — two or three specific things to monitor next.\n\n"
        "Do not invent numbers. Do not repeat the header. If a data caveat is "
        "flagged, carry it into your text rather than dropping it.\n\n"
        f"BOOK CONTEXT\n{_book_context(book)}\n\n"
        f"SCENARIO ON DECK — {scenario['scenario'].name}: "
        f"{scenario['portfolio_pct']:+.1f}% modelled portfolio impact. "
        f"{scenario['scenario'].premise}\n\n"
        f"ANALYST NOTES\n{worker_block}"
    )

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1800,
            messages=[{"role": "user", "content": prompt}],
        )
        body = resp.content[0].text.strip()
        return header + body + _render_footer(book, generated_by=f"{MODEL} (orchestrator-worker)")
    except Exception as exc:  # noqa: BLE001
        return (
            header
            + render_deterministic(book, notes, scenario)
            + f"\n\n> Model synthesis unavailable ({exc}); rendered from data.\n"
        )


def _render_header(book: Book, scenario: dict) -> str:
    return (
        "# THESIS INITIATION REPORT\n"
        "## Beyond the Hyper-Scalers: Quantifying Physical Bottlenecks of the "
        "Global AI CapEx Supercycle\n\n"
        f"**Daily note — {book.as_of:%d %B %Y}**  \n"
        f"*Data as of {book.as_of:%Y-%m-%d %H:%M UTC} · {len(book.entities)} positions · "
        f"base {book.base} · index {book.index_level:.2f}*\n\n"
        "---\n\n"
    )


def _render_footer(book: Book, generated_by: str) -> str:
    origins = sorted({s.origin for e in book.entities for s in e.sources})
    return (
        "\n\n---\n\n"
        f"*Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC} by {generated_by}. "
        f"Sources: {', '.join(origins)}.*\n\n"
        "*Not investment advice. A personal research exercise. Prices are delayed "
        "and sourced from a free public endpoint. Performance figures are a "
        "backward-looking simulation of current weights, not a track record.*\n"
    )


def render_deterministic(book: Book, notes, scenario: dict) -> str:
    """The note, written from data alone. Used when no model is configured."""
    stats = book.curve_stats
    alerts = book.alerts()

    out = ["## Summary\n"]
    if alerts:
        lead = alerts[0]
        out.append(
            f"{len(alerts)} position(s) moved beyond the 2σ alert threshold, led by "
            f"**{lead.ticker}** at {lead.day_return_pct:+.1f}% "
            f"({lead.sigma:+.1f}σ). "
        )
    else:
        out.append("No position moved beyond the 2σ alert threshold. ")
    out.append(
        f"The book sits at index {book.index_level:.2f}, "
        f"{stats.get('ytd', 0):+.1f}% year to date with "
        f"{stats.get('vol', 0):.1f}% annualised volatility and a "
        f"{stats.get('maxDrawdown', 0):+.1f}% maximum drawdown over the window.\n"
    )

    out.append("\n## Signals\n")
    for key, label in (("energy", "Energy"), ("compute", "Compute"), ("ballast", "Ballast")):
        members = [e for e, _ in notes if e.bucket == key]
        if not members:
            continue
        out.append(f"\n**{label} ({book.bucket_weight(key):.0f}%)**\n")
        for entity, text in notes:
            if entity.bucket == key:
                out.append(f"\n{text}\n")

    out.append("\n## Thesis check\n")
    energy = sum(
        (e.day_return_pct or 0) * e.weight for e in book.entities if e.bucket == "energy"
    ) / max(book.bucket_weight("energy"), 1e-9)
    compute = sum(
        (e.day_return_pct or 0) * e.weight for e in book.entities if e.bucket == "compute"
    ) / max(book.bucket_weight("compute"), 1e-9)
    spread = energy - compute
    direction = "supports" if spread > 0 else "undercuts"
    out.append(
        f"Energy carried {energy:+.2f}% on the day against Compute at {compute:+.2f}%, a "
        f"spread of {spread:+.2f}pp. On a single session that {direction} the bottleneck "
        "thesis, though one day of relative performance is not evidence of a "
        "structural constraint — the thesis turns on lead times, not daily prints.\n"
    )

    out.append("\n## Scenario on deck\n")
    sc = scenario["scenario"]
    out.append(
        f"**{sc.name}** — {sc.premise} Modelled portfolio impact "
        f"**{scenario['portfolio_pct']:+.1f}%**, with "
        + ", ".join(f"{k} {v:+.1f}%" for k, v in scenario["by_bucket"].items())
        + f". {sc.note} These shocks are stated assumptions, not estimates from a covariance matrix.\n"
    )

    out.append("\n## Watch\n")
    watch = []
    for entity in book.alerts()[:3]:
        watch.append(f"- **{entity.ticker}** — {entity.alert_reason()}. {entity.breaks}")
    for entity in book.entities:
        if entity.partial:
            watch.append(
                f"- **{entity.ticker}** — only {100 * (entity.coverage or 0):.0f}% of the "
                "measured window; longer-horizon figures exclude it."
            )
    out.append("\n".join(watch) if watch else "- Nothing beyond threshold today.")

    return "".join(out) + _render_footer(book, generated_by="deterministic renderer (no API key set)")
