"""
Generate latest_briefing.md from the current snapshot plus RSS.

    python scripts/build_briefing.py

Reads data/snapshot.json (produced by `npm run refresh`), pulls the feeds, runs
the orchestrator-worker chain, and writes the ER daily note.

Exit codes match the Node pipeline's contract so CI can branch the same way:
    0  note written
    2  refused -- the snapshot is missing or fails its schema check
    1  crashed
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from research import briefing, feeds  # noqa: E402
from research.ontology import SchemaError, load_book  # noqa: E402

OUT = ROOT / "latest_briefing.md"


def main() -> int:
    log = lambda s: print(s, file=sys.stderr)  # noqa: E731

    log(f"\n=== briefing {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC} ===")

    try:
        book = load_book()
    except SchemaError as exc:
        log(f"FAIL  {exc}")
        return 2

    log(f"ok    loaded {len(book.entities)} entities, as of {book.as_of:%Y-%m-%d %H:%M UTC}")

    log("\n-- feeds")
    try:
        collected = feeds.collect(book)
        counts = {k: len(v) for k, v in collected.items() if k != "__book__"}
        got = sum(counts.values())
        empty = [k for k, v in counts.items() if v == 0]
        log(f"ok    {got} items across {len(counts)} entities" + (f"; none for {', '.join(empty)}" if empty else ""))
        log(f"ok    {len(collected.get('__book__', []))} CVM regulator items")
    except Exception as exc:  # noqa: BLE001 - feeds are best-effort by design
        log(f"warn  feed collection degraded: {exc}")

    signals = briefing.select_signals(book)
    log(f"\n-- synthesis\nok    {len(signals)} position(s) selected: " + ", ".join(e.ticker for e in signals))

    keyed = "ANTHROPIC_API_KEY set" if briefing._client() else "no ANTHROPIC_API_KEY — deterministic renderer"
    log(f"ok    {keyed}")

    note = briefing.build(book)
    OUT.write_text(note, encoding="utf-8")
    log(f"\nwrote {OUT.relative_to(ROOT)} ({len(note):,} chars)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"CRASH  {exc}", file=sys.stderr)
        sys.exit(1)
