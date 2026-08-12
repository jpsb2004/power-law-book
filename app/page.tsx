import { Suspense } from "react";
import { getBook, sleeveOrder, sleeveWeightOf, SLEEVES } from "@/lib/quotes";
import type { SleeveId } from "@/lib/holdings";
import { Sparkline } from "@/components/Sparkline";

const SLEEVE_VAR: Record<SleeveId, string> = {
  fuel: "var(--s1)",
  ground: "var(--s2)",
  compute: "var(--s3)",
  ballast: "var(--s4)",
};

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;

const cls = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");

export default function Page() {
  return (
    <div className="wrap">
      <header className="top">
        <p className="eyebrow">Global macro · live book</p>
        <h1>
          The Power
          <br />
          Law Book
        </h1>
        <p style={{ color: "var(--ink-2)", maxWidth: "54ch", marginTop: "1rem" }}>
          Twelve positions on one claim: the demand curve for computation is growing faster
          than the fuel, land and grid that feed it can be rebuilt.
        </p>
      </header>

      {/* Quotes are fetched at request time, so the shell streams first. */}
      <Suspense fallback={<div className="skeleton">PRICING THE BOOK…</div>}>
        <BookView />
      </Suspense>

      <footer>
        <p>
          Quotes from the Yahoo Finance chart API, cached for seconds. Run{" "}
          <code>npm run snapshot &amp;&amp; npm run page</code> to freeze this into the
          standalone page.
        </p>
        <p className="disclaimer">
          Not investment advice, not a recommendation, and not an offer to buy or sell
          anything. A personal research exercise. Prices are delayed, sourced from a free
          public endpoint, and unreconciled against a paid vendor.
        </p>
      </footer>
    </div>
  );
}

async function BookView() {
  const book = await getBook();
  const s = book.curveStats;

  return (
    <>
      <p className="live" style={{ marginTop: "1rem" }}>
        <span className="dot" aria-hidden="true" />
        Live · {new Date(book.asOf).toISOString().slice(0, 16).replace("T", " ")} UTC
      </p>

      {book.degraded && (
        <div className="banner">
          Some quotes failed to load and are shown as “—”. The portfolio curve is computed
          from the positions that did resolve, so it is not comparable with a full run.
        </div>
      )}

      <div className="stats">
        <Stat k="1-year return" v={pct(s.ret1y)} c={cls(s.ret1y)} />
        <Stat k="Year to date" v={pct(s.ytd)} c={cls(s.ytd)} />
        <Stat k="Volatility" v={s.vol == null ? "—" : `${s.vol.toFixed(1)}%`} />
        <Stat k="Max drawdown" v={pct(s.maxDrawdown)} c="neg" />
        <Stat k="Positions" v={String(book.positions.length)} />
      </div>

      <section>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>
          Book index · 12 months · USD · rebased to 100
        </p>
        <Sparkline points={book.curve} height={190} />
        <p style={{ color: "var(--ink-3)", fontSize: "0.82rem" }}>
          Excludes {book.excludedFromCurve.join(", ") || "nothing"} — no public price series.
          Rebalanced daily to target weight; gross of all costs.
        </p>
      </section>

      <section>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>
          Positions
        </p>
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th>Wt</th>
                <th>Last</th>
                <th>Day</th>
                <th>YTD local</th>
                <th>YTD USD</th>
                <th>1y USD</th>
                <th>Vol</th>
                <th>Max DD</th>
              </tr>
            </thead>
            <tbody>
              {sleeveOrder.map((id) => (
                <SleeveRows key={id} id={id} positions={book.positions} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ k, v, c = "" }: { k: string; v: string; c?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v ${c}`}>{v}</div>
    </div>
  );
}

function SleeveRows({
  id,
  positions,
}: {
  id: SleeveId;
  positions: Awaited<ReturnType<typeof getBook>>["positions"];
}) {
  const rows = positions.filter((p) => p.sleeve === id);
  const sleeve = SLEEVES[id];

  return (
    <>
      <tr className="sleeve-row" style={{ ["--sleeve" as string]: SLEEVE_VAR[id] }}>
        <td colSpan={9}>
          {sleeve.numeral} · {sleeve.name} — {sleeveWeightOf(id)}%
        </td>
      </tr>
      {rows.map((p) => (
        <tr key={p.ticker}>
          <td>
            <span className="mono">{p.ticker}</span>
            <br />
            <span style={{ color: "var(--ink-3)", fontSize: "0.78rem" }}>{p.name}</span>
          </td>
          <td className="n">{p.weight}%</td>
          <td className="n">
            {p.price == null
              ? "—"
              : `${p.price.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${p.currency}`}
          </td>
          {p.manual ? (
            <td colSpan={6} style={{ textAlign: "left", color: "var(--ink-3)", fontSize: "0.8rem" }}>
              Private — marked at last round, {p.manualMark?.asOf}. No series.
            </td>
          ) : (
            <>
              <td className={`n ${cls(p.dayChangePct)}`}>{pct(p.dayChangePct)}</td>
              <td className={`n ${cls(p.local?.ytd)}`}>{pct(p.local?.ytd)}</td>
              <td className={`n ${cls(p.usd?.ytd)}`}>{pct(p.usd?.ytd)}</td>
              <td className={`n ${cls(p.usd?.ret1y)}`}>{pct(p.usd?.ret1y)}</td>
              <td className="n">{p.usd?.vol == null ? "—" : `${p.usd.vol.toFixed(0)}%`}</td>
              <td className="n neg">
                {p.usd?.maxDrawdown == null ? "—" : `${p.usd.maxDrawdown.toFixed(0)}%`}
              </td>
            </>
          )}
        </tr>
      ))}
    </>
  );
}
