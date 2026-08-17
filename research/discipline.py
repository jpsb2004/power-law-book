"""
Entry rules and monitoring catalysts.

Single source for two pieces of prose that appear in both the Streamlit
dashboard and the thesis PDF. They live here rather than in either renderer
because the scenario table already taught us what happens when the same numbers
are maintained in two places: the memo drifted to -4.2% while the model said
-17.79% and nothing caught it.

Text is authored in a markdown subset -- **bold** only. Streamlit renders it
directly; the PDF builder converts it (see md_to_rl in scripts/build_thesis_pdf.py).
Write plain `<` and `>` here, not entities -- escaping is the renderer's job.
"""

from __future__ import annotations

# (bucket label, rule). Bucket labels match ontology.BUCKET_LABELS so the two
# can be joined if a renderer wants to sit these beside live weights.
VALUATION_RULES: tuple[tuple[str, str], ...] = (
    (
        "Energy",
        "**Initiation threshold:** Forward EV/EBITDA < 14x **or** FCF Yield > 5.0%. "
        "Position trimmed if NTM EV/EBITDA expands beyond 20x without corresponding "
        "reserve/interconnect capacity growth.",
    ),
    (
        "Compute",
        "Cap total exposure if Basket Forward P/E > 32x or NTM PEG > 1.8. Serves as "
        "pure valuation-disciplined macro insurance.",
    ),
    (
        "Ballast",
        "Rebalance when yield spread / discount to NAV deviates by >1.5 standard "
        "deviations from the 3-year trailing mean.",
    ),
)

# (heading, body). Deliberately near-term: the thesis runs on 3-5 year physical
# lead times, which daily price action cannot validate. These are the things
# that actually resolve inside a few quarters, so the horizon mismatch the memo
# concedes in section 4 has an answer rather than being left open.
CATALYSTS: tuple[tuple[str, str], ...] = (
    (
        "Policy & Grid Reform",
        "Track compliance timelines and cluster-study clearing under **FERC Order 2023** "
        "(US interconnection queue reform), alongside PJM and ERCOT capacity auction "
        "clearing prices. Queue throughput is the single most direct read on whether the "
        "interconnect bottleneck is binding or easing.",
    ),
    (
        "Supply Chain Lead Times",
        "Monitor quarterly management guidance on high-voltage transformer and switchgear "
        "lead times from key equipment OEMs — **Eaton Corp (ETN)**, **Hubbell (HUBB)** and "
        "**Schneider Electric**. Guidance revisions front-run the physical constraint by "
        "several quarters.",
    ),
    (
        "Nuclear PPAs & Co-location",
        "Track announcements of direct-connect nuclear Power Purchase Agreements "
        "(**Constellation Energy**, **Talen Energy**, **Vistra**) and hyperscaler "
        "co-location approvals. Each signed PPA is a datable observation that baseload "
        "scarcity is being priced.",
    ),
)
