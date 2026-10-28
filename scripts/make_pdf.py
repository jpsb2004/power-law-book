"""
Build the thesis PDF — "The Power Law Book".

    python scripts/make_pdf.py

Output: <repo root>/The_Power_Law_Book_Thesis.pdf

This is a reconstruction. The original generator was lost, leaving a 5-page PDF
nobody could edit; the layout here was measured back off that file (frames,
type sizes, palette, rules) so the output matches it.

Two things changed on purpose:

  * Every figure is read from the live book rather than typed in. The old file
    hardcoded an index level, a coverage percentage and a scenario impact, all
    of which go stale silently -- the coverage line already read 6% against a
    dashboard showing 8%.
  * The charts are drawn as vectors. The original embedded two matplotlib PNGs,
    which meant a heavy dependency that was never in requirements.txt, and
    raster charts that blur when zoomed.

Prose is carried over verbatim, including the decision to model only the grid
scenario and leave the other two qualitative.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Group, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, Frame, FrameBreak, KeepTogether, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from research.discipline import CATALYSTS, VALUATION_RULES  # noqa: E402
from research.ontology import BUCKET_LABELS, BUCKET_ORDER, load_book  # noqa: E402
from research.scenarios import CAPEX_RETRENCHMENT, GEOPOLITICAL_SHOCK, GRID_BOTTLENECK, apply_scenario  # noqa: E402

OUTPUT = ROOT / "The_Power_Law_Book_Thesis.pdf"

# ---------------------------------------------------------------- palette
INK = colors.HexColor("#1A1A1A")       # body text
SPINE = colors.HexColor("#1C1F26")     # left bar and box headers
BLUE = colors.HexColor("#1F5FA8")      # section eyebrows, rules
GREY = colors.HexColor("#5A5A5A")      # deck, sidebar labels
FAINT = colors.HexColor("#8A8A8A")     # footer
RULE = colors.HexColor("#C8CDD4")

BUCKET_INK = {"Substrate": colors.HexColor("#B5790A"),
              "Compute": colors.HexColor("#1F6FB2"),
              "Materials": colors.HexColor("#65389F"),
              "Diversifiers": colors.HexColor("#A02060")}
BUCKET_TINT = {"Substrate": colors.HexColor("#FAF3E4"),
               "Compute": colors.HexColor("#EAF1F8"),
               "Materials": colors.HexColor("#F0EBF7"),
               "Diversifiers": colors.HexColor("#F9EAF1")}
# Display order and labels come from the ontology, so a bucket added there
# reaches every table and chart below without another hand-kept list.
ORDER = [BUCKET_LABELS[k] for k in BUCKET_ORDER]
DIVERSIFIERS = BUCKET_LABELS["ballast"]
NUMBER_WORDS = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}
CREAM = colors.HexColor("#F7F1E3")

# --------------------------------------------------------------- geometry
PAGE_W, PAGE_H = letter
SPINE_W = 15.8
L, R = 54.0, 568.8                     # footer / body text edges
FOOT_RULE_Y = PAGE_H - 747.4           # 44.6
FOOT_TEXT_Y = PAGE_H - 758.0           # 34.0

COVER_L, COVER_R = 90.0, 360.4         # cover main column
SIDE_L, SIDE_R = 374.4, 518.4          # cover sidebar
COVER_RULE_Y = PAGE_H - 57.0           # 735
BODY_RULE_Y = PAGE_H - 63.0            # 729

LEGAL = ("An educational exercise, not a securities analysis report: the author is not a CVM-registered securities analyst (Resolução CVM 20) or investment adviser, and nothing here is a recommendation.")
DISCLAIMER = ("Independent personal research. Not investment advice. "
              "Not affiliated with any bank or financial institution.")


# ------------------------------------------------------------------ data
POSITIONS = json.loads((ROOT / "data" / "positions.json").read_text(encoding="utf-8"))

book = load_book()
stats = book.curve_stats
grid = apply_scenario(book, GRID_BOTTLENECK)
capex = apply_scenario(book, CAPEX_RETRENCHMENT)
geo = apply_scenario(book, GEOPOLITICAL_SHOCK)
grid_buckets = grid["by_bucket"]

_thin = {e.ticker: e.coverage for e in book.entities
         if e.coverage is not None and e.coverage < 0.95}
RARA_COVER = f"{100 * _thin.get('RARA11.SA', 0.0):.0f}%"

N_POSITIONS = len(book.entities)
_rara = next((e for e in book.entities if e.ticker == "RARA11.SA"), None)
RARA_W = _rara.weight if _rara else 0.0
RARA_WEEKS = round(52 * (_rara.coverage or 0)) if _rara else 0
N_CURRENCIES = len({e.currency for e in book.entities})

BUCKET_N = {}
BUCKET_W = {}
for e in book.entities:
    BUCKET_N[e.bucket_label] = BUCKET_N.get(e.bucket_label, 0) + 1
    BUCKET_W[e.bucket_label] = BUCKET_W.get(e.bucket_label, 0.0) + e.weight

REPORT_DATE = f"{book.as_of:%d %B %Y}"


def pct(v: float, dp: int = 1) -> str:
    """Signed percent using a real minus sign, as the original set it."""
    return f"{v:+.{dp}f}%".replace("-", "−")


# ---------------------------------------------------------------- styles
def _p(name, **kw):
    base = dict(fontName="Times-Roman", fontSize=9.6, leading=13.0,
                textColor=INK, alignment=TA_JUSTIFY)
    base.update(kw)
    return ParagraphStyle(name, **base)


masthead = _p("masthead", fontName="Times-Bold", fontSize=22, leading=24, alignment=0)
eyebrow = _p("eyebrow", fontName="Helvetica-Bold", fontSize=8.3, leading=11,
             textColor=BLUE, alignment=0, spaceBefore=18, spaceAfter=6,
             keepWithNext=True)
headline = _p("headline", fontName="Times-Bold", fontSize=15, leading=18, alignment=0,
              spaceAfter=7, keepWithNext=True)
cover_head = _p("cover_head", fontName="Times-Bold", fontSize=17, leading=20.5, alignment=0)
deck = _p("deck", fontName="Times-Italic", fontSize=10, leading=13.5,
          textColor=GREY, alignment=0, spaceBefore=8, spaceAfter=10)
body = _p("body", spaceAfter=7)
cover_body = _p("cover_body", fontSize=9.2, leading=12.4, spaceAfter=7)
sub_head = _p("sub_head", fontName="Times-Bold", fontSize=11, leading=14, alignment=0,
              spaceBefore=9, spaceAfter=5, keepWithNext=True)
# One head style per bucket, differing only in bullet colour. The original set
# these dots in ZapfDingbats; reportlab emits that font without a usable
# encoding here (every code point renders as the .notdef box), so this uses the
# WinAnsi bullet oversized to match the original's diameter. bulletOffsetY drops
# it onto the text's optical centre (positive is up in reportlab, so this is
# negative) -- <font rise> is not a valid span attribute.
POS_HEAD = {
    bucket: _p(f"pos_head_{bucket}", fontName="Helvetica-Bold", fontSize=9.2, leading=12,
               alignment=0, leftIndent=14, spaceBefore=6, spaceAfter=2, keepWithNext=True,
               bulletFontName="Helvetica-Bold", bulletFontSize=17, bulletColor=ink,
               bulletIndent=4, bulletOffsetY=-3.4)
    for bucket, ink in BUCKET_INK.items()
}
pos_body = _p("pos_body", leftIndent=14, fontSize=9.4, leading=12.6, spaceAfter=2)
weakness = _p("weakness", leftIndent=14, spaceAfter=6)
inset = _p("inset", leftIndent=20, fontSize=9.4, leading=12.6, spaceAfter=6)

side_label = _p("side_label", fontName="Helvetica", fontSize=8.3, leading=11,
                textColor=GREY, alignment=0)
side_value = _p("side_value", fontName="Helvetica-Bold", fontSize=8.3, leading=11, alignment=TA_RIGHT)
side_body = _p("side_body", fontName="Helvetica", fontSize=8.0, leading=11.5, alignment=0)
side_body_i = _p("side_body_i", fontName="Helvetica-Oblique", fontSize=8.0, leading=11.5,
                 textColor=GREY, alignment=0)
box_head = _p("box_head", fontName="Helvetica-Bold", fontSize=8, leading=11,
              textColor=colors.white, alignment=0)
tbl_head = _p("tbl_head", fontName="Helvetica-Bold", fontSize=8.6, leading=11,
              textColor=colors.white, alignment=0)
tbl_cell = _p("tbl_cell", fontSize=9.0, leading=11.6, alignment=0)
disc_body = _p("disc_body", fontName="Helvetica", fontSize=7.4, leading=10.4, textColor=GREY)

# The original set these dots in ZapfDingbats. reportlab emits that font here
# without a usable encoding -- every code point comes out as the .notdef box --
# so use the WinAnsi bullet in Helvetica, which is round, coloured, and real.
# Size 17 matches the original dot's diameter against 9.2pt text; the style's
# explicit leading keeps the oversized glyph from opening up the line.
catalyst_style = _p("catalyst", leftIndent=14, spaceAfter=6,
                    bulletFontName="Helvetica-Bold", bulletFontSize=17,
                    bulletColor=BUCKET_INK["Substrate"], bulletIndent=4, bulletOffsetY=-3.4)


# ---------------------------------------------------------------- charts
class Chart(Drawing):
    """Base: no axes furniture beyond what the original showed."""


def allocation_chart(width=136, height=88):
    """Horizontal target-weight bars for the cover sidebar."""
    d = Drawing(width, height)
    order = ORDER
    x0, top, row_h, bar_h = 34.0, height - 10.0, 14.0, 8.0
    span = width - x0 - 22.0
    scale = span / 40.0                      # axis runs 0..40%
    d.add(Rect(0, 0, width, height, fillColor=CREAM, strokeColor=None))
    for i, label in enumerate(order):
        y = top - (i + 1) * row_h + 4
        w = BUCKET_W.get(label, 0.0) * scale
        d.add(String(x0 - 4, y + 2, label, fontName="Helvetica", fontSize=5.5,
                     fillColor=GREY, textAnchor="end"))
        d.add(Rect(x0, y, w, bar_h, fillColor=BUCKET_INK[label], strokeColor=None))
        d.add(String(x0 + w + 3, y + 2, f"{BUCKET_W.get(label, 0):.0f}%",
                     fontName="Helvetica-Bold", fontSize=5.5, fillColor=INK))
    axis_y = top - len(order) * row_h + 1
    d.add(Line(x0, axis_y, x0 + span, axis_y, strokeColor=RULE, strokeWidth=0.5))
    for tick in (0, 10, 20, 30, 40):
        tx = x0 + tick * scale
        d.add(Line(tx, axis_y, tx, axis_y - 2, strokeColor=RULE, strokeWidth=0.5))
        d.add(String(tx, axis_y - 9, str(tick), fontName="Helvetica", fontSize=5,
                     fillColor=GREY, textAnchor="middle"))
    d.add(String(x0 + span / 2, axis_y - 17, "Target weight (%)", fontName="Helvetica",
                 fontSize=5, fillColor=GREY, textAnchor="middle"))
    return d


def scenario_chart(width=133, height=74):
    """Per-bucket contribution for the grid scenario, straight from the model."""
    d = Drawing(width, height)
    order = ORDER
    vals = [grid_buckets.get(k, 0.0) for k in order]
    d.add(Rect(0, 0, width, height, fillColor=CREAM, strokeColor=None))
    left, base_pad, plot_h = 26.0, 16.0, height - 26.0
    span = width - left - 6.0
    lo, hi = min(vals + [0.0]), max(vals + [0.0])
    pad = (hi - lo) * 0.28 or 1.0
    lo, hi = lo - pad, hi + pad
    zero_y = base_pad + (0 - lo) / (hi - lo) * plot_h
    d.add(Line(left, zero_y, left + span, zero_y, strokeColor=RULE, strokeWidth=0.5))
    d.add(Line(left, base_pad, left, base_pad + plot_h, strokeColor=RULE, strokeWidth=0.5))
    for t in (1, 0, -1, -2, -3):
        if lo <= t <= hi:
            ty = base_pad + (t - lo) / (hi - lo) * plot_h
            d.add(String(left - 3, ty - 1.6, str(t), fontName="Helvetica", fontSize=5,
                         fillColor=GREY, textAnchor="end"))
    slot = span / len(order)
    for i, (label, v) in enumerate(zip(order, vals)):
        cx = left + slot * (i + 0.5)
        bw = slot * 0.46
        h = abs(v) / (hi - lo) * plot_h
        y = zero_y if v >= 0 else zero_y - h
        d.add(Rect(cx - bw / 2, y, bw, h, fillColor=BUCKET_INK[label], strokeColor=None))
        ly = (y + h + 2) if v >= 0 else (y - 6)
        d.add(String(cx, ly, pct(v), fontName="Helvetica-Bold", fontSize=5.5,
                     fillColor=INK, textAnchor="middle"))
        d.add(String(cx, base_pad - 7, label, fontName="Helvetica", fontSize=5.5,
                     fillColor=GREY, textAnchor="middle"))
    # Rotated, as the original had it. A horizontal String here is anchored
    # middle and overhangs the drawing's left edge, printing over the body text
    # beside it -- a Drawing does not clip what its children draw outside it.
    axis_label = Group(String(0, 0, "Modelled impact (%)", fontName="Helvetica",
                              fontSize=5, fillColor=GREY, textAnchor="middle"))
    axis_label.translate(7, base_pad + plot_h / 2)
    axis_label.rotate(90)
    d.add(axis_label)
    return d


# ------------------------------------------------------- page decoration
def _footer(c, page_no):
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.line(L, FOOT_RULE_Y, R, FOOT_RULE_Y)
    c.setFont("Helvetica", 7)
    c.setFillColor(FAINT)
    c.drawString(L, FOOT_TEXT_Y, DISCLAIMER)
    c.drawRightString(R, FOOT_TEXT_Y, f"Page {page_no}")


def _spine(c):
    c.setFillColor(SPINE)
    c.rect(0, 0, SPINE_W, PAGE_H, stroke=0, fill=1)


def draw_cover(c, doc):
    c.saveState()
    _spine(c)
    c.setFillColor(INK)
    c.setFont("Times-Bold", 22)
    c.drawString(COVER_L, PAGE_H - 29.6, "The Power Law Book")
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(COVER_L, PAGE_H - 43.4, "INDEPENDENT THEMATIC RESEARCH")
    c.setStrokeColor(BLUE)
    c.setLineWidth(1.1)
    c.line(COVER_L, COVER_RULE_Y, COVER_R, COVER_RULE_Y)
    _footer(c, doc.page)
    c.restoreState()


def draw_body(c, doc):
    c.saveState()
    _spine(c)
    c.setFillColor(INK)
    c.setFont("Times-Bold", 11.5)
    c.drawString(L, PAGE_H - 36.8, "The Power Law Book")
    c.setFillColor(BLUE)
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(L, PAGE_H - 49.5, "INDEPENDENT THEMATIC RESEARCH")
    c.setFillColor(FAINT)
    c.setFont("Helvetica", 7.5)
    c.drawRightString(R, PAGE_H - 37.5, "Global Equity: Thematic Portfolio")
    c.drawRightString(R, PAGE_H - 48.3, REPORT_DATE)
    c.setStrokeColor(BLUE)
    c.setLineWidth(1.1)
    c.line(L, BODY_RULE_Y, R, BODY_RULE_Y)
    _footer(c, doc.page)
    c.restoreState()


# ------------------------------------------------------------- fragments
def boxed_header(text, width):
    t = Table([[Paragraph(text, box_head)]], colWidths=[width], rowHeights=[20])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SPINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


BUCKET_LABEL = BUCKET_LABELS


def positions_in(bucket):
    """Active positions for one bucket, in roster order."""
    return [p for p in POSITIONS["positions"]
            if p["bucket"] == bucket and p.get("status", "active") == "active"]


def position(p):
    """
    One rationale block, entirely derived from data/positions.json.

    The weight used to be a hardcoded idealised equal-weight ("~5.4%") while the
    book actually held integers -- all 18 disagreed with the dashboard. It now
    reads the real weight, and the "~" is gone because the figure is exact.
    """
    label = BUCKET_LABEL[p["bucket"]]
    # The SSOT stores plain text, not reportlab markup -- the app renders the
    # same strings and would print a literal "&amp;". Escaping is the renderer's
    # job, so a bare & becomes an entity only on the way into a Paragraph.
    esc = lambda s: s.replace("&", "&amp;")
    name = esc(p["memo"]["name"])
    text = esc(p["memo"]["rationale"]).replace("{coverage}", RARA_COVER)
    flags = "".join(f" · <i>{esc(f)}</i>" for f in p.get("classification_flags", []))
    return [Paragraph(f"<b>{esc(p['ticker'])}: {name}</b> · {p['weight']:.1f}%{flags}",
                      POS_HEAD[label], bulletText="•"),
            Paragraph(text, pos_body)]


story = []

# =========================================================== COVER (p1)
story += [
    Paragraph("EQUITY STRATEGY · PORTFOLIO INITIATION", eyebrow),
    Paragraph("Quantifying the Physical Bottlenecks<br/>of the Global AI CapEx Supercycle", cover_head),
    Paragraph(
        "Own the ordered physical chain behind AI compute, with more capital in the upstream links. "
        f"Compute is held as a counterweight and Diversifiers cushion drawdowns across {N_POSITIONS} positions "
        f"in {N_CURRENCIES} currencies.", deck),
]
for lead, rest in [
    ("The consensus AI trade is crowded.",
     " Hyperscalers and their primary silicon suppliers are the obvious way to own the "
     "buildout, and the most efficiently priced. This book is built to express a different, "
     "less crowded layer of the same trade."),
    ("The binding constraint is shifting from silicon to substrate.",
     " Grid interconnect queues and transformer lead times, not chip supply, increasingly "
     "gate how fast new capacity can actually come online."),
    ("Construction is top-down, not stock-by-stock.",
     " Bucket targets are "
     + " / ".join(f"{b} {BUCKET_W.get(b, 0):.0f}%" for b in ORDER) + ". Weights within each bucket "
     "are set line by line, and the change log records why. Equal capital is not equal risk: see the risk table on the published page."),
    ("Compute is retained on purpose, not shrunk to a token hedge.",
     " A portfolio that only wins if hyperscalers underperform their own suppliers is a weaker "
     "construction than one that wins when the upstream links outpace compute but does not collapse if they fall behind."),
    ("Every position carries a standing falsification note:",
     " the specific condition under which its inclusion in the thesis is wrong. The critical-minerals "
     "ETF sits in its own Materials bucket rather than being counted as a diversifier. See Section 4."),
]:
    story.append(Paragraph(f"•&nbsp;<b>{lead}</b>{rest}", cover_body))

story.append(FrameBreak())

# ---- sidebar
SIDE_W = SIDE_R - SIDE_L
story.append(boxed_header("BACKTEST METRICS", SIDE_W))
_bk = next((r for r in (book.benchmarks or {}).get("rows", []) if r.get("key") == "book-usd"), None)
metrics = [
    ("Index level", f"{book.index_level:.2f}"),
    ("YTD (USD)", pct(stats.get("ytd", 0.0))),
    ("1-year (USD)", pct(stats.get("ret1y", 0.0))),
    ("Volatility (ann.)", f"{stats.get('vol', 0.0):.1f}%"),
    ("Max drawdown", pct(stats.get("maxDrawdown", 0.0))),
]
if _bk and _bk.get("stats", {}).get("sharpe") is not None:
    metrics.append(("Sharpe (vs T-bills)", f"{_bk['stats']['sharpe']:.2f}"))
mt = Table([[Paragraph(k, side_label), Paragraph(v, side_value)] for k, v in metrics],
           colWidths=[SIDE_W * 0.58, SIDE_W * 0.42], rowHeights=[21] * len(metrics))
mt.setStyle(TableStyle([
    ("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE),
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (0, -1), 8),
    ("RIGHTPADDING", (-1, 0), (-1, -1), 8),
]))
story += [mt, Spacer(1, 4), Paragraph(
              "Hindsight backtest, not a track record: today's weights replayed over twelve months, "
              f"rebalanced {(book.rebalancing or {}).get('base', 'daily')}, gross of costs.", side_body_i),
          Spacer(1, 8), boxed_header("BUCKET ALLOCATION", SIDE_W), Spacer(1, 6),
          allocation_chart(SIDE_W, 88), Spacer(1, 12),
          boxed_header("AUTHOR", SIDE_W), Spacer(1, 7),
          Paragraph("<b>João</b>", side_body),
          Paragraph("Business Administration student, ESPM São Paulo", side_body),
          Paragraph("Independent researcher (personal portfolio project)", side_body),
          Paragraph("Not affiliated with any bank or financial institution", side_body_i)]

story += [NextPageTemplate("body"), PageBreak()]

# ======================================================= 2. CONSTRUCTION
story += [
    Paragraph("2. PORTFOLIO CONSTRUCTION", eyebrow),
    Paragraph("Bucket Weights and Factor Logic", headline),
    Paragraph(
        f"The book is organized into {NUMBER_WORDS[len(ORDER)]} thematic buckets rather than picked stock-by-stock. "
        "Bucket targets are set first; weights within each bucket are set line by line, and the "
        "change log records why. Equal capital is not equal risk: see the risk table on the published page. "
        "The bet is on the theme, not on any individual name being the best "
        "operator in it.", body),
]

rows = [[Paragraph(h, tbl_head) for h in ("Bucket", "Weight", "N", "Structural exposure")]]
exposure = {
    "Substrate": "Fuel, generation, land, interconnect rights and grid equipment:<br/>the most direct expression of the thesis",
    "Compute": "The hardware layer itself: a counterweight in case<br/>the upstream links lag compute",
    "Materials": "Rare earths and strategic metals: the export-controlled inputs<br/>to magnets, motors and turbines",
    "Diversifiers": "Cross-asset diversifiers, monetary safety assets, and<br/>developed-market value, sized to cushion drawdown",
}
for b in ORDER:
    rows.append([Paragraph(b, tbl_cell), Paragraph(f"{BUCKET_W[b]:.1f}%", tbl_cell),
                 Paragraph(str(BUCKET_N[b]), tbl_cell), Paragraph(exposure[b], tbl_cell)])
bt = Table(rows, colWidths=[78, 62, 36, 314])
bt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), SPINE),
    *[("BACKGROUND", (0, i), (-1, i), BUCKET_TINT[b]) for i, b in enumerate(ORDER, start=1)],
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story += [Spacer(1, 4), bt, Spacer(1, 9), Paragraph(
    f"Substrate ({BUCKET_W.get('Substrate', 0):.0f}%) is weighted above Compute ({BUCKET_W.get('Compute', 0):.0f}%) "
    "deliberately: fuel, land and the grid equipment that connects them are the more direct, less crowded "
    "expression of the thesis. Compute is kept as a counterweight on purpose, at the weight in the table above: a "
    "portfolio that only wins if hyperscalers underperform their own suppliers is a weaker "
    "construction than one that wins when the upstream links outpace compute but does not "
    "collapse if they fall behind. Diversifiers are sized to absorb drawdown from the rest of the book rather than to add "
    "a competing return thesis.", body)]

# Equal capital is not equal risk: the same Euler decomposition the page shows,
# read from the snapshot rather than recomputed here.
_risk = (book.risk or {}).get("usd") or {}
_rrows = sorted((r for r in _risk.get("rows", []) if r.get("riskSharePct") is not None),
                key=lambda r: -r["riskSharePct"])
if _rrows:
    _top = _rrows[:2]
    _bk = {b["sleeve"]: b for b in _risk.get("buckets", [])}
    _bal = _bk.get("ballast")
    story.append(Paragraph(
        "Equal capital is not equal risk. Measured as each line's share of the book's variance "
        f"(weekly USD returns, {_risk['weeks']} weeks), {_top[0]['key']} and {_top[1]['key']} hold "
        f"{sum(r['weightPct'] for r in _top):.0f}% of the capital and "
        f"{sum(r['riskSharePct'] for r in _top):.0f}% of the risk"
        + (f"; Diversifiers hold {_bal['weightPct']:.0f}% of the capital and {_bal['riskSharePct']:.0f}% of the risk"
           if _bal else "")
        + ". The full table is on the published page.", body))

# ---- NEW: valuation discipline
val_rows = [[Paragraph(h, tbl_head) for h in ("Bucket", "Initiation threshold and trim discipline")]]
for label, rule in VALUATION_RULES:
    val_rows.append([Paragraph(label, tbl_cell),
                     Paragraph(rule.replace("**", ""), tbl_cell)])
vt = Table(val_rows, colWidths=[78, 412])
vt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), SPINE),
    *[("BACKGROUND", (0, i), (-1, i), BUCKET_TINT[label])
      for i, (label, _) in enumerate(VALUATION_RULES, start=1)],
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story += [
    Paragraph("Valuation Discipline and Entry Criteria", sub_head),
    Paragraph(
        "A weight target says how much to hold, not what price makes it worth holding. Each "
        "bucket carries an explicit initiation threshold and a trim rule, so a position that "
        "re-rates away from its thesis is cut on a stated condition rather than on sentiment.",
        body),
    vt,
]

# ---- valuation snapshot (P1-4): what each line is priced at, with source and date
_fu = book.fundamentals or {}
if _fu.get("valuation"):
    def _m(v, suf):
        if v is None:
            return "—"
        if v < 0 and suf == "x":
            return "n.m."
        return f"{v:.1f}{suf}"
    _vr = [[Paragraph(h, tbl_head) for h in ("Line", "Fwd P/E", "Trail. P/E", "EV/EBITDA", "FCF yld", "Div yld")]]
    for v in _fu["valuation"]:
        _vr.append([Paragraph(v["ticker"] + (" *" if v.get("currencyNote") else ""), tbl_cell),
                    Paragraph(_m(v.get("forwardPE"), "x"), tbl_cell), Paragraph(_m(v.get("trailingPE"), "x"), tbl_cell),
                    Paragraph(_m(v.get("evToEbitda"), "x"), tbl_cell), Paragraph(_m(v.get("fcfYieldPct"), "%"), tbl_cell),
                    Paragraph(_m(v.get("dividendYieldPct"), "%"), tbl_cell)])
    _vt = Table(_vr, colWidths=[90, 70, 70, 70, 70, 70], repeatRows=1)
    _vt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SPINE), ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    _cn = " ".join(f"* {v['ticker']}: {v['currencyNote']}." for v in _fu["valuation"] if v.get("currencyNote"))
    # The Compute trim rule, checked: weight-averaged earnings yield of the
    # bucket's lines with a positive forward P/E, inverted (harmonic mean).
    _cl = [v for v in _fu["valuation"]
           if v.get("forwardPE") and v["forwardPE"] > 0
           and next((e.bucket for e in book.entities if e.ticker == v["ticker"]), "") == "compute"]
    _bpe = (sum(1 for _ in _cl) / sum(1 / v["forwardPE"] for v in _cl)) if _cl else None
    _rule = (f" Compute basket forward P/E (harmonic mean of {', '.join(v['ticker'] for v in _cl)}): "
             f"<b>{_bpe:.1f}x</b> against the 32x cap in the Compute rule"
             + (" — the cap binds." if _bpe > 32 else " — inside the cap.")) if _bpe else ""
    story += [KeepTogether([
        Paragraph("Valuation Snapshot", sub_head),
        Paragraph(
            f"What each line is priced at, from {_fu['source']} on {_fu['asOf']}. Funds show the fund-level P/E and "
            "distribution yield; n.m. marks a negative multiple. " + _cn + _rule, body),
        _vt,
    ])]

# ========================================================== 3. RATIONALE
story += [
    Paragraph("3. MICROECONOMIC MAPPING", eyebrow),
    Paragraph("Position-Level Rationale", headline),
    Paragraph(f"Substrate ({BUCKET_W['Substrate']:.1f}%, {BUCKET_N['Substrate']} positions)", sub_head),
]
for _p in positions_in("energy"):
    story.append(KeepTogether(position(_p)))

story.append(Paragraph(f"Compute &amp; Hardware ({BUCKET_W['Compute']:.1f}%, {BUCKET_N['Compute']} positions)", sub_head))
for _p in positions_in("compute"):
    story.append(KeepTogether(position(_p)))

_n_mat = BUCKET_N.get("Materials", 0)
story.append(Paragraph(f"Critical Materials ({BUCKET_W.get('Materials', 0):.1f}%, {_n_mat} "
                       f"position{'' if _n_mat == 1 else 's'})", sub_head))
for _p in positions_in("materials"):
    story.append(KeepTogether(position(_p)))

story.append(Paragraph(f"{DIVERSIFIERS} ({BUCKET_W[DIVERSIFIERS]:.1f}%, {BUCKET_N[DIVERSIFIERS]} positions)", sub_head))
for _p in positions_in("ballast"):
    story.append(KeepTogether(position(_p)))

# ======================================================== 4. DISCLOSURES
story += [
    Paragraph("4. ANALYTICAL DISCLOSURES", eyebrow),
    Paragraph("Known Portfolio Weaknesses", headline),
    Paragraph(
        "Every position in the live dashboard carries a standing falsification note: the "
        "specific condition under which its place in the thesis is wrong, refreshed alongside "
        "the daily data pull. The intent is to make it structurally harder to only look for "
        "evidence that confirms the thesis. The open weaknesses, stated plainly:", body),
    Paragraph(
        "<b>Concentration.</b> Measured on weekly returns, the "
        f"{N_POSITIONS}-position book behaves like "
        + (f"{(book.structure or {}).get('enb', 0):.1f} effective bets"
           + (f" (90% sampling range {book.structure['enbRange']['p05']:.1f}–{book.structure['enbRange']['p95']:.1f})"
              if (book.structure or {}).get("enbRange") else "")
           + f", with {(book.structure or {}).get('firstPcSharePct', 0):.0f}% of its variance on one common factor."
           if book.structure else "far fewer independent bets than it has lines."), weakness),
    Paragraph(
        "<b>Materials concentration and liquidity drag.</b> RARA11.SA sits in its own Materials "
        "bucket rather than in Diversifiers, because it is correlated with the same technology-materials "
        f"cycle the rest of the book is long. Its thin trading history (~{RARA_COVER} active "
        "coverage in the measured window) adds noise to any long-horizon variance figure.", weakness),
    Paragraph(
        "<b>Temporal horizon mismatch.</b> Daily deviation tracking compares short-term market "
        "noise against a multi-year infrastructure lead-time thesis (permitting and transformer "
        "procurement run three to five years). Daily relative performance between Substrate and "
        "Compute is an operational monitoring routine, not statistical validation.", weakness),
]

# ---- NEW: catalysts, answering the horizon mismatch directly above
story += [
    Paragraph("Near-Term Monitoring Catalysts", sub_head),
    Paragraph(
        "The mismatch above is real but not unanswerable. Three things resolve inside nought to "
        "four quarters and bear directly on whether the physical constraint is binding, which is "
        "what daily price action cannot tell you:", body),
]
for heading, text in CATALYSTS:
    story.append(Paragraph(
        f"<b>{heading.replace('&', '&amp;')}.</b> {text.replace('**', '')}",
        catalyst_style, bulletText="•"))

# ---- variant view, falsifiers, concentration (P1-4, P1-3)
_th = book.thesis or {}
_sx = book.structure or {}
if _th:
    def _rd(c):
        if c.get("reading") is None:
            return "checked each earnings season"
        u = c.get("unit")
        return f"${c['reading']:.2f}" if u == "$" else (f"{c['reading']:+.1f}pp" if u == "pp" else f"{c['reading']:+.1f}%")
    def _x(t):
        return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    _fr = [[Paragraph(h, tbl_head) for h in ("Falsifier", "Test", "Reading", "Status")]]
    for c in _th.get("checks", []):
        _st = "watch" if c.get("triggered") is None else ("<b>triggered</b>" if c["triggered"] else "holding")
        _tx = c["test"]
        if c.get("consequence"):
            _tx += f"<br/><b>If met:</b> {_x(c['consequence'])}"
        # Snapshots before falsifier governance carry no latestResponse key: no badge for them.
        if c.get("triggered") is True and "latestResponse" in c:
            _r = c["latestResponse"]
            if _r:
                _tx += f"<br/><b>Response, {_x(_r['date'])} ({_x(_r['decision'])}):</b> {_x(_r['text'])}"
                _st += f"<br/>{_x(_r['decision'])}, {_x(_r['date'])}"
            else:
                _st += "<br/><b>UNANSWERED</b>"
        _fr.append([Paragraph(c["name"], tbl_cell), Paragraph(_tx, tbl_cell), Paragraph(_rd(c), tbl_cell),
                    Paragraph(_st, tbl_cell)])
    _ft = Table(_fr, colWidths=[95, 255, 80, 60], repeatRows=1)
    _ft.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SPINE), ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story += [
        Paragraph("Variant View and Falsifiers", sub_head),
        Paragraph(_th["variantView"], body),
        Paragraph(f"<b>Horizon.</b> {_th['horizon']} <b>Review and exit.</b> {_th['reviewRules']}", body),
        _ft,
    ]
if _sx:
    _pf = "; ".join(f"{g['name']} {g['capitalPct']:.0f}% of capital, {g['riskSharePct']:.0f}% of risk"
                    for g in _sx.get("pointsOfFailure", []))
    story.append(Paragraph(
        f"<b>{N_POSITIONS} lines, {_sx['enb']:.1f} effective bets.</b> Splitting the book's weekly variance across its "
        f"principal components, the first carries {_sx['firstPcSharePct']:.0f}% of it; the entropy-based effective "
        f"number of bets is {_sx['enb']:.1f} of {_sx['lines']} lines"
        + (f" (90% sampling range {_sx['enbRange']['p05']:.1f}–{_sx['enbRange']['p95']:.1f}; first component "
           f"{_sx['firstPcRange']['p05']:.0f}–{_sx['firstPcRange']['p95']:.0f}%, from a block bootstrap of the "
           f"{_sx['weeks']} weeks). Small samples also overstate the first component, a bias the range does not "
           "remove, so the effective number of bets is more likely understated than overstated"
           if _sx.get("enbRange") and _sx.get("firstPcRange") else "")
        + f". Shared points of failure: {_pf}.", body))

# ---- change log: every change to the book or its method, from positions.json
_changes = sorted(POSITIONS.get("book_changes", []), key=lambda c: c["date"], reverse=True)
if _changes:
    _cl = [[Paragraph(h, tbl_head) for h in ("Date", "What changed", "Why")]]
    for c in _changes:
        _why = c["why"] + (" <b>What breaks it:</b> " + c["breaks"].split("What breaks it: ", 1)[-1] if c.get("breaks") else "")
        _cl.append([Paragraph(c["date"], tbl_cell),
                    Paragraph(c["change"].replace("&", "&amp;"), tbl_cell),
                    Paragraph(_why.replace("&", "&amp;").replace("&amp;lt;", "&lt;"), tbl_cell)])
    clt = Table(_cl, colWidths=[62, 250, 178], repeatRows=1)
    clt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SPINE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story += [
        Paragraph("Change Log", sub_head),
        Paragraph(
            "The figures in this note replay today's book, so every change below rewrites them; the live "
            "record on the published page is chain-linked from its inception and is not rewritten. Entries "
            "before 14 October 2026 are reconstructed from the repository history.", body),
        clt,
    ]

# ============================================================== 5. RISK
story += [
    Paragraph("5. RISK FRAMEWORK", eyebrow),
    Paragraph("Scenario Stress-Testing", headline),
    Paragraph(
        f"An empirical covariance matrix, estimated over a year of daily data across {NUMBER_WORDS.get(N_CURRENCIES, N_CURRENCIES)} "
        f"currencies (one line with {RARA_WEEKS} weeks of trading history), would look statistically rigorous "
        "while being almost entirely noise. The portfolio uses stated-assumption scenario shocks "
        "instead.", body),
]
grid_text = Paragraph(
    "Interconnection queues and transformer lead times, not chip supply, become the binding "
    "constraint; announced data-centre builds slip. Modelled portfolio impact "
    f"<b>{pct(grid['portfolio_pct'])}</b> ("
    + ", ".join(f"{b} {pct(grid_buckets.get(b, 0))}" for b in ORDER) + "). "
    "This is the scenario the book is built to profit from being right about: the one where a "
    "negative headline number still confirms the thesis is working as designed.", inset)
gt = Table([[grid_text, scenario_chart(133, 74)]], colWidths=[340, 150])
gt.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (0, 0), 20),
    ("RIGHTPADDING", (-1, 0), (-1, 0), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
]))
story += [gt, Spacer(1, 8), Paragraph(
    "<b>CapEx Retrenchment</b> (cyclical digestion): hyperscalers cut AI capital-spending "
    "guidance and the supercycle is re-rated as an ordinary cycle. This is the scenario the "
    "Compute bucket exists to cushion against, and the one most likely to hurt every bucket at "
    f"once. Modelled impact <b>{pct(capex['portfolio_pct'])}</b> on the stated shocks; the position "
    "sizing, not a forecast, is the hedge.", body), Paragraph(
    "<b>Geopolitical Shock</b> (Taiwan Strait escalation): advanced foundry output is "
    "interrupted and export controls tighten on strategic materials. The tail scenario the "
    "portfolio is least hedged against: TSM, 2357.TW and EWY all sit in the impact zone and "
    "are closer to one bet than three. RARA11.SA is the one line that works here, since the same "
    f"export controls that interrupt foundry output bid rare earths up, but at {RARA_W:.0f}% it cannot "
    f"offset a Compute bucket {BUCKET_W['Compute'] / (RARA_W or 1):.0f} times its size. Modelled impact "
    f"<b>{pct(geo['portfolio_pct'])}</b> on the stated shocks, which treat the three Taiwan- and Korea-linked lines "
    "as impaired rather than merely marked down.", body)]

# ---- the historical record and the tail (P1-1), read from the snapshot
_stress = book.stress or {}
_tail = book.tail or {}
if _stress.get("historical"):
    _rows = [[Paragraph(h, tbl_head) for h in ("Scenario", "Window", "Book", "VGT", "ACWI", "60/40")]]
    for h in _stress["historical"]:
        b = h.get("benchmarks", {})
        _rows.append([Paragraph(h["name"], tbl_cell), Paragraph(f"{h['start']} to {h['end']}", tbl_cell),
                      Paragraph(f"<b>{pct(h['bookPct'])}</b>", tbl_cell), Paragraph(pct(b.get("VGT")), tbl_cell),
                      Paragraph(pct(b.get("ACWI")), tbl_cell), Paragraph(pct(b.get("60/40")), tbl_cell)])
    for h in _stress.get("hypothetical", []):
        _rows.append([Paragraph(h["name"], tbl_cell), Paragraph(f"beta {h['beta']:.2f} to {h['factor']}", tbl_cell),
                      Paragraph(f"<b>{pct(h['bookPct'])}</b>", tbl_cell), Paragraph(pct(h["shockPct"]), tbl_cell),
                      Paragraph("—", tbl_cell), Paragraph("—", tbl_cell)])
    st_t = Table(_rows, colWidths=[150, 120, 55, 55, 55, 55], repeatRows=1)
    st_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SPINE), ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    _d = (_tail.get("daily") or [None, None])
    _w = (_tail.get("weekly") or [None, None])
    _var = (f" Historical one-day VaR at 95% is {_d[0]['varPct']:.1f}% (CVaR {_d[0]['cvarPct']:.1f}%), "
            f"one-week VaR at 95% {_w[0]['varPct']:.1f}% (CVaR {_w[0]['cvarPct']:.1f}%)." if _d[0] and _w[0] else "")
    story += [
        Paragraph("The Historical Record", sub_head),
        Paragraph(
            "Today's weights held through the worst stretches of the last five years, using each line's own "
            "history where it existed and a stated stand-in where it did not ("
            + ", ".join(f"{k} as {v['ticker']}" for k, v in (_stress.get("proxies") or {}).items())
            + ")." + _var, body),
        st_t,
    ]

# ---- what the returns are made of, and what else could have been held (P1-2, P0-1)
_f = book.factors or {}
_brow = next((r for r in _f.get("rows", []) if r.get("key") == "book" and not r.get("insufficient")), None)
_bm = book.benchmarks or {}
_rows_bm = {r["key"]: r.get("stats") or {} for r in _bm.get("rows", [])}
if _brow:
    _fx = ", ".join(f"{x['ticker']} {_brow['betas'][x['id']]:.2f}" for x in _f["factors"])
    _bk = _rows_bm.get("book-usd", {})
    _vgt = _rows_bm.get("vgt", {})
    _acwi = _rows_bm.get("acwi", {})
    story += [
        Paragraph("Exposure, Not Alpha", sub_head),
        Paragraph(
            f"Weekly excess returns over {_f['window']['start'][:4]}–{_f['window']['end'][:4]} load {_fx} on global equity, "
            f"semiconductors and energy, with R² {_brow['r2']:.2f}. "
            "In a hindsight backtest an intercept measures selection, not edge, which is why the book is judged by its live record. "
            + (f"Over the latest year the book's Sharpe ratio was {_bk['sharpe']:.2f}, against {_vgt['sharpe']:.2f} for VGT "
               f"(US tech) and {_acwi['sharpe']:.2f} for ACWI (global equity): it did not beat simply holding tech "
               "per unit of risk." if _bk.get('sharpe') is not None and _vgt.get('sharpe') is not None and _bk['sharpe'] < _vgt['sharpe']
               else (f"Over the latest year the book's Sharpe ratio was {_bk['sharpe']:.2f}, against {_vgt.get('sharpe', 0):.2f} for VGT "
                     f"and {_acwi.get('sharpe', 0):.2f} for ACWI." if _bk.get('sharpe') is not None else "")),
            body),
    ]

callout = Table([[Paragraph(
    "<b>Why stated assumptions instead of a fitted model.</b> A covariance matrix estimated "
    f"from a year of daily data across {NUMBER_WORDS.get(N_CURRENCIES, N_CURRENCIES)} currencies would look statistically rigorous and "
    "would be almost entirely noise, given how little history several positions have. The three "
    "scenarios are therefore stated shocks, written down per position in data/scenarios.json so "
    "they can be argued with, and checked against what actually happened in the historical "
    "windows above rather than presented as forecasts.", body)]], colWidths=[R - L - 72])
callout.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), CREAM),
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
]))
story += [Spacer(1, 6), Table([[callout]], colWidths=[R - L],
                              style=[("LEFTPADDING", (0, 0), (-1, -1), 36),
                                     ("RIGHTPADDING", (0, 0), (-1, -1), 36),
                                     ("TOPPADDING", (0, 0), (-1, -1), 0),
                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 0)])]

# ========================================================= 6. TECH STACK
story += [
    Paragraph("6. TECHNICAL STACK", eyebrow),
    Paragraph("Ingestion Pipeline &amp; Architecture", headline),
    Paragraph(
        "The dashboard is built and deployed on Streamlit. Text generation for the daily note "
        "and the per-position falsification commentary runs through a deterministic, rule-based "
        "renderer rather than a live LLM call. No API key is configured in the deployed version, "
        "so the analytical judgment embedded in the classifications and the self-critique is "
        "fixed at build time, not generated fresh each day. What refreshes on weekdays is the "
        "price, volume, and news data feeding that fixed framework: Google News RSS, SEC EDGAR's "
        "Atom feed for filings, and the Yahoo Finance chart v8 endpoint for prices. This is a "
        "deliberate choice worth stating plainly, since it affects what the analytical work in "
        "the project actually is: it sits in the research and portfolio-construction decisions, "
        "not in a model narrating markets live.", body),
]

disc = Table([[boxed_header("IMPORTANT DISCLOSURES", R - L)],
              [Paragraph(
                  "This document is prepared solely by the author as a personal research and "
                  "portfolio-construction exercise, intended to demonstrate analytical process "
                  "for professional evaluation purposes such as a CV or job application. It is "
                  "not prepared by, affiliated with, reviewed by, or endorsed by any bank, "
                  "broker-dealer, or financial institution, and its formatting is modelled on "
                  "sell-side research conventions for presentation purposes only. It does not "
                  "constitute financial advice, an offer to buy or sell any security, or an "
                  "investment recommendation, and the author is not a licensed financial "
                  "advisor. Market data is delayed and sourced from free public endpoints. "
                  "Performance figures are a backward-looking simulation of current portfolio "
                  "weights over a window ending on the report date and do not represent a live "
                  "track record. The thesis, positions and weights are the author's; all "
                  "software behind this report, the data pipeline and the published page was "
                  "written by Claude Code, Anthropic's AI coding agent, under the author's "
                  "direction. " + LEGAL, disc_body)]], colWidths=[R - L])
disc.setStyle(TableStyle([
    ("BOX", (0, 1), (-1, 1), 0.5, RULE),
    ("LEFTPADDING", (0, 0), (-1, 0), 0),
    ("RIGHTPADDING", (0, 0), (-1, 0), 0),
    ("TOPPADDING", (0, 0), (-1, 0), 0),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
    ("LEFTPADDING", (0, 1), (-1, 1), 14),
    ("RIGHTPADDING", (0, 1), (-1, 1), 14),
    ("TOPPADDING", (0, 1), (-1, 1), 14),
    ("BOTTOMPADDING", (0, 1), (-1, 1), 12),
]))
# Kept whole: split, its header strands at the foot of one page and its text
# opens the next.
story += [Spacer(1, 14), KeepTogether(disc)]


def build(output=OUTPUT):
    doc = BaseDocTemplate(str(output), pagesize=letter,
                          title="The Power Law Book: Independent Thematic Research",
                          author="João", subject="Global Equity: Thematic Portfolio")
    cover_main = Frame(COVER_L, 54, COVER_R - COVER_L, 674, id="cover_main",
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    cover_side = Frame(SIDE_L, 54, SIDE_R - SIDE_L, PAGE_H - 10.8 - 54, id="cover_side",
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body_frame = Frame(L, 54, R - L, BODY_RULE_Y - 54 - 12, id="body",
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[cover_main, cover_side], onPage=draw_cover),
        PageTemplate(id="body", frames=[body_frame], onPage=draw_body),
    ])
    doc.build(story)
    print(f"Wrote {output}")


if __name__ == "__main__":
    build()
