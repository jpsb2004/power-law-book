import type { Point } from "@/lib/analytics";

/**
 * Server-rendered index curve. No client JS: the app's job is to prove the
 * data layer works, and the published snapshot page carries the interactive
 * version.
 */
export function Sparkline({
  points,
  height = 180,
}: {
  points: Point[];
  height?: number;
}) {
  if (points.length < 2) {
    return <div className="skeleton">NO SERIES</div>;
  }

  const W = 1000;
  const m = { t: 12, r: 52, b: 20, l: 4 };
  const iw = W - m.l - m.r;
  const ih = height - m.t - m.b;

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.c);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad;
  hi += pad;

  const X = (t: number) => m.l + ((t - x0) / (x1 - x0)) * iw;
  const Y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const line = points
    .map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(2)} ${Y(p.c).toFixed(2)}`)
    .join(" ");
  const last = points[points.length - 1];

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ display: "block", width: "100%", height: "auto" }}
        role="img"
        aria-label={`Book index over 12 months, ending at ${last.c.toFixed(1)}`}
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <g key={f}>
              <line x1={m.l} x2={m.l + iw} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" strokeWidth={1} />
              <text
                x={m.l + iw + 8}
                y={Y(v) + 4}
                fill="var(--ink-3)"
                fontSize={11}
                fontFamily="var(--font-mono)"
              >
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}

        {lo < 100 && hi > 100 && (
          <line
            x1={m.l}
            x2={m.l + iw}
            y1={Y(100)}
            y2={Y(100)}
            stroke="var(--rule-strong)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}

        <path d={`${line} L ${X(x1)} ${Y(lo)} L ${X(x0)} ${Y(lo)} Z`} fill="url(#sparkFill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        <circle
          cx={X(last.t)}
          cy={Y(last.c)}
          r={4.5}
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
}
