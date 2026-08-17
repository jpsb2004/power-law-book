"""
THESIS INITIATION REPORT — interactive macro research dashboard.

    streamlit run app.py

Reads the artifacts the pipeline produces:
    data/snapshot.json    market data, FX, deviations   (npm run refresh)
    latest_briefing.md    the ER daily note             (python scripts/build_briefing.py)

It does not fetch anything itself. A dashboard that re-fetches on every widget
interaction is slow, rate-limited, and shows numbers that disagree with the note
sitting next to them.
"""

from __future__ import annotations

from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

from research.discipline import CATALYSTS, VALUATION_RULES
from research.ontology import BUCKET_ORDER, SchemaError, load_book
from research.scenarios import SCENARIOS, combined

ROOT = Path(__file__).resolve().parent
BRIEFING = ROOT / "latest_briefing.md"

# Same hues as the published page, validated for colourblind separation and
# contrast across all pairs rather than picked by eye.
BUCKET_COLOUR = {"Energy": "#AE6A12", "Compute": "#0F7BC0", "Ballast": "#B02D6E"}
GAIN, LOSS, MUTED = "#2E7D5B", "#B4382F", "#6E7A7F"

st.set_page_config(
    page_title="Thesis Initiation Report — Physical Bottlenecks of the AI CapEx Supercycle",
    page_icon="⚡",
    layout="wide",
)


@st.cache_data(ttl=300)
def _load():
    book = load_book()
    rows = [
        {
            "Ticker": e.ticker,
            "Name": e.name,
            "Bucket": e.bucket_label,
            "Weight": e.weight,
            "Currency": e.currency,
            "Venue": e.venue,
            "Price": e.price,
            "Day %": e.day_return_pct,
            "Sigma": e.sigma,
            "vs 50d mean %": e.from_mean_pct,
            "vs 12m high %": e.from_high_pct,
            "Volume x avg": e.volume_ratio,
            "YTD USD %": e.ytd_usd,
            "1y USD %": e.ret1y_usd,
            "Vol %": e.vol_usd,
            "Max DD %": e.max_drawdown_usd,
            "Coverage": e.coverage,
            "Partial": e.partial,
            "Alert": e.alert_reason() or "",
        }
        for e in book.entities
    ]
    return book, pd.DataFrame(rows)


try:
    book, df = _load()
except SchemaError as exc:
    st.error(f"**Snapshot unavailable.**\n\n{exc}")
    st.stop()

# ----------------------------------------------------------------- masthead
st.title("Beyond the Hyper-Scalers")
st.caption(
    "Quantifying the physical bottlenecks of the global AI CapEx supercycle · "
    f"{len(book.entities)} positions · base {book.base} · "
    f"data as of {book.as_of:%Y-%m-%d %H:%M UTC}"
)

stats = book.curve_stats
cols = st.columns(5)
cols[0].metric("Index", f"{book.index_level:.2f}", f"{(book.index_level or 100) - 100:+.1f} vs base")
cols[1].metric("YTD (USD)", f"{stats.get('ytd', 0):+.1f}%")
cols[2].metric("1-year (USD)", f"{stats.get('ret1y', 0):+.1f}%")
cols[3].metric("Volatility", f"{stats.get('vol', 0):.1f}%")
cols[4].metric("Max drawdown", f"{stats.get('maxDrawdown', 0):+.1f}%")

partial = [e for e in book.entities if e.partial]
if partial:
    st.warning(
        "**Coverage caveat.** "
        + "; ".join(
            f"{e.ticker} traded in only {100 * (e.coverage or 0):.0f}% of the measured window"
            for e in partial
        )
        + ". The curve renormalises across whatever is trading on each date, so the "
        "longer-horizon figures above describe the positions actually present — not always all "
        f"{len(book.entities)}."
    )

tab_alloc, tab_note, tab_dev, tab_stress = st.tabs(
    ["Allocation", "ER Daily Note", "Deviation & Alerts", "Stress Tests"]
)

# --------------------------------------------------------------- allocation
with tab_alloc:
    left, right = st.columns([1, 1])

    bucket_df = (
        df.groupby("Bucket", as_index=False)["Weight"]
        .sum()
        .assign(Order=lambda d: d["Bucket"].map({"Energy": 0, "Compute": 1, "Ballast": 2}))
        .sort_values("Order")
    )

    with left:
        st.subheader("By bucket")
        st.altair_chart(
            alt.Chart(bucket_df)
            .mark_arc(innerRadius=70, stroke="#fff", strokeWidth=2)
            .encode(
                theta=alt.Theta("Weight:Q", stack=True),
                color=alt.Color(
                    "Bucket:N",
                    scale=alt.Scale(
                        domain=list(BUCKET_COLOUR), range=list(BUCKET_COLOUR.values())
                    ),
                    legend=alt.Legend(title=None, orient="bottom"),
                ),
                tooltip=["Bucket", alt.Tooltip("Weight:Q", format=".0f", title="Weight %")],
            )
            .properties(height=300),
            use_container_width=True,
        )

    with right:
        st.subheader("By position")
        st.altair_chart(
            alt.Chart(df.sort_values(["Bucket", "Weight"], ascending=[True, False]))
            .mark_bar(cornerRadiusEnd=3)
            .encode(
                y=alt.Y("Ticker:N", sort="-x", title=None),
                x=alt.X("Weight:Q", title="Weight (%)"),
                color=alt.Color(
                    "Bucket:N",
                    scale=alt.Scale(
                        domain=list(BUCKET_COLOUR), range=list(BUCKET_COLOUR.values())
                    ),
                    legend=None,
                ),
                tooltip=["Ticker", "Name", "Bucket", alt.Tooltip("Weight:Q", format=".0f")],
            )
            .properties(height=460),
            use_container_width=True,
        )

    st.info(
        "Bucket targets are Energy 38 / Compute 32 / Ballast 30, split equally within each "
        "bucket. Two classification notes worth arguing with: **NBIS and CRWV sit in Energy** "
        "but are compute landlords that consume power rather than supply it, and "
        "**RARA11.SA sits in Ballast** but is a concentrated, policy-driven rare-earth basket "
        "that tracks the same technology-materials cycle as the rest of the book, so in most "
        "states it falls with the book rather than against it. The exception is an "
        "export-control shock — toggle Geopolitical Shock under Stress Tests and it is the "
        "largest positive contributor in the book."
    )

    # Both blocks below share their text with the thesis PDF via
    # research/discipline.py -- edit there, not here, or the two drift apart.
    st.subheader("Valuation discipline & entry criteria")
    st.caption(
        "A weight target says how much to hold, not what price makes it worth holding. "
        "These are the entry and trim rules attached to each bucket."
    )
    st.table(
        pd.DataFrame(
            [{"Bucket": label, "Initiation threshold & trim discipline": rule}
             for label, rule in VALUATION_RULES]
        ).set_index("Bucket")
    )

    st.subheader("Near-term monitoring catalysts (0–4 quarters)")
    st.caption(
        "The thesis runs on 3–5 year physical lead times, which daily price action cannot "
        "validate. These resolve inside a few quarters, so the horizon mismatch has an answer."
    )
    for heading, body in CATALYSTS:
        st.markdown(f"- **{heading}:** {body}")

# ------------------------------------------------------------------- report
with tab_note:
    if BRIEFING.exists():
        st.markdown(BRIEFING.read_text(encoding="utf-8"))
    else:
        st.warning(
            "`latest_briefing.md` not found. Generate it with "
            "`python scripts/build_briefing.py` (requires `data/snapshot.json`)."
        )

# ---------------------------------------------------------------- deviation
with tab_dev:
    st.subheader("Alerts")
    alerts = book.alerts()
    if alerts:
        for e in alerts:
            tone = st.error if (e.error or e.fx_missing) else (st.success if (e.sigma or 0) > 0 else st.warning)
            tone(f"**{e.ticker}** ({e.bucket_label}, {e.weight}%) — {e.alert_reason()}")
    else:
        st.success("No position beyond the 2σ threshold, and no data-quality faults.")

    st.subheader("Daily deviation")
    st.caption(
        "Sigma is the day's move in standard deviations of that position's own trailing "
        "return distribution — the only way to compare a 3% day in GLD with a 3% day in CRWV."
    )
    dev = df.dropna(subset=["Sigma"]).sort_values("Sigma")
    st.altair_chart(
        alt.Chart(dev)
        .mark_bar(cornerRadiusEnd=3)
        .encode(
            y=alt.Y("Ticker:N", sort=alt.EncodingSortField("Sigma", order="descending"), title=None),
            x=alt.X("Sigma:Q", title="Standard deviations"),
            color=alt.condition(alt.datum.Sigma > 0, alt.value(GAIN), alt.value(LOSS)),
            tooltip=[
                "Ticker",
                "Name",
                alt.Tooltip("Day %:Q", format="+.2f"),
                alt.Tooltip("Sigma:Q", format="+.2f"),
                alt.Tooltip("Volume x avg:Q", format=".2f"),
            ],
        )
        .properties(height=460),
        use_container_width=True,
    )

    st.subheader("Full metrics")
    st.dataframe(
        df.drop(columns=["Alert"]).style.format(
            {
                "Weight": "{:.0f}",
                "Price": "{:,.2f}",
                "Day %": "{:+.2f}",
                "Sigma": "{:+.2f}",
                "vs 50d mean %": "{:+.1f}",
                "vs 12m high %": "{:+.1f}",
                "Volume x avg": "{:.2f}",
                "YTD USD %": "{:+.1f}",
                "1y USD %": "{:+.1f}",
                "Vol %": "{:.0f}",
                "Max DD %": "{:.0f}",
                "Coverage": "{:.0%}",
            },
            na_rep="—",
        ),
        use_container_width=True,
        hide_index=True,
    )

# ------------------------------------------------------------------- stress
with tab_stress:
    st.subheader("Scenario shocks")
    st.caption(
        "These are **stated assumptions, not estimates from a covariance matrix.** A year of "
        "daily data across six currencies — including one fund with three weeks of history — "
        "cannot support an estimated correlation structure, and one built on it would look "
        "rigorous while being noise."
    )

    chosen = []
    toggles = st.columns(3)
    for col, key in zip(toggles, SCENARIOS):
        scenario = SCENARIOS[key]
        with col:
            if st.toggle(scenario.name, value=(key == "grid"), key=f"tog_{key}"):
                chosen.append(key)
            st.caption(scenario.premise)

    result = combined(book, chosen)
    if result is None:
        st.info("Select at least one scenario.")
    else:
        impact = result["portfolio_pct"]
        st.metric("Modelled portfolio impact", f"{impact:+.1f}%")
        if len(chosen) > 1:
            st.warning(
                "Shocks are summed across scenarios, and these scenarios are **not "
                "independent** — a grid bottleneck makes capex retrenchment more likely, not "
                "less. Read a combined figure as an ordering of severity, not a forecast."
            )

        bucket_impact = pd.DataFrame(
            [{"Bucket": k, "Impact": v} for k, v in result["by_bucket"].items()]
        )
        st.altair_chart(
            alt.Chart(bucket_impact)
            .mark_bar(cornerRadiusEnd=3)
            .encode(
                x=alt.X("Bucket:N", title=None, sort=["Energy", "Compute", "Ballast"]),
                y=alt.Y("Impact:Q", title="Contribution to portfolio (%)"),
                color=alt.Color(
                    "Bucket:N",
                    scale=alt.Scale(domain=list(BUCKET_COLOUR), range=list(BUCKET_COLOUR.values())),
                    legend=None,
                ),
                tooltip=["Bucket", alt.Tooltip("Impact:Q", format="+.2f")],
            )
            .properties(height=240),
            use_container_width=True,
        )

        rows = pd.DataFrame(result["rows"])
        st.altair_chart(
            alt.Chart(rows)
            .mark_bar(cornerRadiusEnd=3)
            .encode(
                y=alt.Y("ticker:N", sort=alt.EncodingSortField("contribution_pct"), title=None),
                x=alt.X("contribution_pct:Q", title="Contribution to portfolio impact (%)"),
                color=alt.condition(
                    alt.datum.contribution_pct > 0, alt.value(GAIN), alt.value(LOSS)
                ),
                tooltip=[
                    "ticker",
                    "name",
                    "bucket",
                    alt.Tooltip("weight:Q", format=".0f"),
                    alt.Tooltip("shock_pct:Q", format="+.0f", title="Assumed shock %"),
                    alt.Tooltip("contribution_pct:Q", format="+.2f"),
                ],
            )
            .properties(height=460),
            use_container_width=True,
        )
        st.caption(result["scenario"].note)

st.divider()
st.caption(
    "Not investment advice, not a recommendation, and not an offer to buy or sell anything. "
    "A personal research exercise. Prices are delayed and sourced from a free public endpoint. "
    "Performance figures are a backward-looking simulation of the current weights over a window "
    "ending today — not a track record."
)
