"""
Build the thesis PDF — "Beyond the Hyper-Scalers".

    python scripts/make_pdf.py

Output: <repo root>/Beyond_the_Hyper-Scalers_Thesis.pdf

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
from research.ontology import load_book  # noqa: E402
from research.scenarios import GRID_BOTTLENECK, apply_scenario  # noqa: E402

OUTPUT = ROOT / "Beyond_the_Hyper-Scalers_Thesis.pdf"

# ---------------------------------------------------------------- palette
INK = colors.HexColor("#1A1A1A")       # body text
SPINE = colors.HexColor("#1C1F26")     # left bar and box headers
BLUE = colors.HexColor("#1F5FA8")      # section eyebrows, rules
GREY = colors.HexColor("#5A5A5A")      # deck, sidebar labels
FAINT = colors.HexColor("#8A8A8A")     # footer
RULE = colors.HexColor("#C8CDD4")

BUCKET_INK = {"Energy": colors.HexColor("#B5790A"),
              "Compute": colors.HexColor("#1F6FB2"),
              "Ballast": colors.HexColor("#A02060")}
BUCKET_TINT = {"Energy": colors.HexColor("#FAF3E4"),
               "Compute": colors.HexColor("#EAF1F8"),
               "Ballast": colors.HexColor("#F9EAF1")}
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

DISCLAIMER = ("Independent personal research. Not investment advice. "
              "Not affiliated with any bank or financial institution.")


# ------------------------------------------------------------------ data
book = load_book()
stats = book.curve_stats
grid = apply_scenario(book, GRID_BOTTLENECK)
grid_buckets = grid["by_bucket"]

_thin = {e.ticker: e.coverage for e in book.entities
         if e.coverage is not None and e.coverage < 0.95}
RARA_COVER = f"{100 * _thin.get('RARA11.SA', 0.0):.0f}%"

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
                    bulletColor=BUCKET_INK["Energy"], bulletIndent=4, bulletOffsetY=-3.4)


# ---------------------------------------------------------------- charts
class Chart(Drawing):
    """Base: no axes furniture beyond what the original showed."""


def allocation_chart(width=136, height=74):
    """Horizontal target-weight bars for the cover sidebar."""
    d = Drawing(width, height)
    order = ["Energy", "Compute", "Ballast"]
    x0, top, row_h, bar_h = 34.0, height - 10.0, 18.0, 9.0
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
    axis_y = top - 3 * row_h + 1
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
    order = ["Energy", "Compute", "Ballast"]
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
    c.drawString(COVER_L, PAGE_H - 29.6, "Beyond the Hyper-Scalers")
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
    c.drawString(L, PAGE_H - 36.8, "Beyond the Hyper-Scalers")
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


def position(ticker, name, weight, text):
    bucket = next((e.bucket_label for e in book.entities if e.ticker == ticker), "Energy")
    return [Paragraph(f"<b>{ticker}: {name}</b> · ~{weight}", POS_HEAD[bucket], bulletText="•"),
            Paragraph(text, pos_body)]


story = []

# =========================================================== COVER (p1)
story += [
    Paragraph("EQUITY STRATEGY · PORTFOLIO INITIATION", eyebrow),
    Paragraph("Quantifying the Physical Bottlenecks<br/>of the Global AI CapEx Supercycle", cover_head),
    Paragraph(
        "Overweight Energy, hold Compute as a counterweight, and size Ballast to absorb "
        "drawdown. 18 positions across six exchanges express a rotation out of hyperscaler "
        "beta and into the physical infrastructure that gates it.", deck),
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
     f" Target weights are set at the bucket level (Energy {BUCKET_W['Energy']:.0f}% / "
     f"Compute {BUCKET_W['Compute']:.0f}% / Ballast {BUCKET_W['Ballast']:.0f}%); positions "
     "inside each bucket are held close to equal-weight so no single stock call carries the thesis."),
    ("Compute is retained on purpose, not shrunk to a token hedge.",
     " A portfolio that only wins if hyperscalers underperform their own suppliers is a weaker "
     "construction than one that wins on the rotation but does not collapse if the rotation stalls."),
    ("Every position carries a standing falsification note:",
     " the specific condition under which its inclusion in the thesis is wrong. Two "
     "classification calls (the neocloud names, the critical-minerals ETF) are flagged as "
     "stretches rather than smoothed over. See Section 4."),
]:
    story.append(Paragraph(f"•&nbsp;<b>{lead}</b>{rest}", cover_body))

story.append(FrameBreak())

# ---- sidebar
SIDE_W = SIDE_R - SIDE_L
story.append(boxed_header("KEY METRICS", SIDE_W))
metrics = [
    ("Index level", f"{book.index_level:.2f}"),
    ("YTD (USD)", pct(stats.get("ytd", 0.0))),
    ("1-year (USD)", pct(stats.get("ret1y", 0.0))),
    ("Volatility (ann.)", f"{stats.get('vol', 0.0):.1f}%"),
    ("Max drawdown", pct(stats.get("maxDrawdown", 0.0))),
]
mt = Table([[Paragraph(k, side_label), Paragraph(v, side_value)] for k, v in metrics],
           colWidths=[SIDE_W * 0.58, SIDE_W * 0.42], rowHeights=[21] * len(metrics))
mt.setStyle(TableStyle([
    ("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE),
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (0, -1), 8),
    ("RIGHTPADDING", (-1, 0), (-1, -1), 8),
]))
story += [mt, Spacer(1, 10), boxed_header("BUCKET ALLOCATION", SIDE_W), Spacer(1, 6),
          allocation_chart(SIDE_W, 74), Spacer(1, 12),
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
        "The book is organized into three thematic buckets rather than picked stock-by-stock. "
        "Target weights are set at the bucket level; positions within a bucket are then held "
        "close to equal-weight, so no single stock-picking call inside a bucket is doing "
        "outsized work. The bet is on the theme, not on any individual name being the best "
        "operator in it.", body),
]

rows = [[Paragraph(h, tbl_head) for h in ("Bucket", "Weight", "N", "Structural exposure")]]
exposure = {
    "Energy": "Baseload generation, transmission, fuel supply, land and<br/>interconnect rights: the most direct expression of the thesis",
    "Compute": "The hardware layer itself: a macro counterweight against<br/>being wrong about the timing of the rotation",
    "Ballast": "Cross-asset hedges, monetary safety assets, and<br/>development-market value, sized to absorb drawdown",
}
for b in ("Energy", "Compute", "Ballast"):
    rows.append([Paragraph(b, tbl_cell), Paragraph(f"{BUCKET_W[b]:.1f}%", tbl_cell),
                 Paragraph(str(BUCKET_N[b]), tbl_cell), Paragraph(exposure[b], tbl_cell)])
bt = Table(rows, colWidths=[78, 62, 36, 314])
bt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), SPINE),
    ("BACKGROUND", (0, 1), (-1, 1), BUCKET_TINT["Energy"]),
    ("BACKGROUND", (0, 2), (-1, 2), BUCKET_TINT["Compute"]),
    ("BACKGROUND", (0, 3), (-1, 3), BUCKET_TINT["Ballast"]),
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story += [Spacer(1, 4), bt, Spacer(1, 9), Paragraph(
    "Energy is weighted above Compute deliberately: it is the more direct, less crowded "
    "expression of the thesis. Compute is kept at close to a third of the book on purpose: a "
    "portfolio that only wins if hyperscalers underperform their own suppliers is a weaker "
    "construction than one that wins on the rotation but does not collapse if the rotation "
    "stalls. Ballast is sized to absorb drawdown from the other two buckets rather than to add "
    "a competing return thesis.", body)]

# ---- NEW: valuation discipline
val_rows = [[Paragraph(h, tbl_head) for h in ("Bucket", "Initiation threshold and trim discipline")]]
for label, rule in VALUATION_RULES:
    val_rows.append([Paragraph(label, tbl_cell),
                     Paragraph(rule.replace("**", ""), tbl_cell)])
vt = Table(val_rows, colWidths=[78, 412])
vt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), SPINE),
    ("BACKGROUND", (0, 1), (-1, 1), BUCKET_TINT["Energy"]),
    ("BACKGROUND", (0, 2), (-1, 2), BUCKET_TINT["Compute"]),
    ("BACKGROUND", (0, 3), (-1, 3), BUCKET_TINT["Ballast"]),
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

# ========================================================== 3. RATIONALE
story += [
    Paragraph("3. MICROECONOMIC MAPPING", eyebrow),
    Paragraph("Position-Level Rationale", headline),
    Paragraph(f"Energy &amp; Power ({BUCKET_W['Energy']:.1f}%, {BUCKET_N['Energy']} positions)", sub_head),
]
for args in [
    ("URA", "Global X Uranium ETF", "5.4%",
     "Nuclear is the fastest-permitting large-scale answer to hyperscaler 24/7 power demand; "
     "the broadest, most liquid way to hold exposure to the fuel cycle."),
    ("NLR", "VanEck Uranium &amp; Nuclear ETF", "5.4%",
     "Deliberate overlap with URA on the nuclear theme rather than diversifying away from it. "
     "Conviction is high enough to accept concentration in exchange for broader coverage across "
     "the fuel cycle and regulated utilities."),
    ("PETR4.SA", "Petrobras", "5.4%",
     "A large, cash-generative conventional producer as a hedge against nuclear permitting "
     "delays: thermal generation remains the marginal supplier during interim grid deficits."),
    ("2222.SR", "Saudi Aramco", "5.4%",
     "Same logic as PETR4.SA with a different sovereign and cost-curve position; diversifies "
     "the conventional-energy leg across geography rather than concentrating it in one producer."),
    ("LB", "LandBridge Company", "5.4%",
     "Surface and water rights exposure in the Permian Basin: a direct read on "
     "interconnection-queue monetization and data-centre land-siting, the physical layer "
     "underneath the generation names."),
    ("NBIS", "Nebius Group", "5.4%",
     "Classified here as a power consumer, which is a stretch I flag rather than hide: Nebius "
     "is a compute landlord: capex-funded, customer-concentrated, and competing with the "
     "hyperscalers it sells to. It sits in Energy because its unit economics are gated by power "
     "access, not because it generates power."),
    ("CRWV", "CoreWeave", "5.4%",
     "Same classification stretch as NBIS, and the two overlap enough operationally that this "
     "is closer to one position expressed twice than two independent bets (see Section 4)."),
]:
    story.append(KeepTogether(position(*args)))

story.append(Paragraph(f"Compute &amp; Hardware ({BUCKET_W['Compute']:.1f}%, {BUCKET_N['Compute']} positions)", sub_head))
for args in [
    ("TSM", "Taiwan Semiconductor Manufacturing", "4.6%",
     "The central foundry bottleneck and the counterweight the thesis has to survive: "
     "near-monopoly on advanced-node and CoWoS packaging capacity captures the demand growth "
     "directly if the rotation thesis is wrong or early."),
    ("AMD", "Advanced Micro Devices", "4.6%",
     "Second-source accelerator exposure, kept smaller than a conviction bet would be: this "
     "bucket is insurance against the thesis, not a parallel thesis of its own."),
    ("PLTR", "Palantir Technologies", "4.6%",
     "Software/deployment-layer exposure, included so the bucket is not pure hardware and does "
     "not miss the demand side entirely."),
    ("VGT", "Vanguard Information Technology ETF", "4.6%",
     "A broad, low-conviction sleeve that keeps the bucket from being a handful of single-name "
     "bets on a theme this book is intentionally underweighting."),
    ("2357.TW", "ASUSTeK Computer", "4.6%",
     "Server assembly exposure: margin-thin and customer-concentrated, and the legacy PC cycle "
     "still outweighs the AI server line in reported revenue. Held as a read on physical "
     "assembly capacity, not a pure AI-server bet."),
    ("^KS11", "KOSPI Composite Index", "4.6%",
     "An index proxy for Korea's memory manufacturing exposure to the buildout, avoiding having "
     "to pick between the two dominant memory makers."),
    ("AINF.L", "AI Infrastructure UCITS ETF (LSE)", "4.6%",
     "A packaged, diversified sleeve of infrastructure and connectivity names as a "
     "lower-maintenance complement to the single-name bets elsewhere in the bucket."),
]:
    story.append(KeepTogether(position(*args)))

story.append(Paragraph(f"Macro Ballast ({BUCKET_W['Ballast']:.1f}%, {BUCKET_N['Ballast']} positions)", sub_head))
for args in [
    ("GLD", "SPDR Gold Shares", "7.5%",
     "Classic drawdown hedge, uncorrelated to the CapEx cycle either way. Held to reduce "
     "portfolio volatility, not to express a view."),
    ("AVDV", "Avantis Intl Small Cap Value ETF", "7.5%",
     "Deliberately away from the AI theme entirely: developed-market, value-tilted, small-cap "
     "exposure as a genuine diversifier rather than a disguised extra bet on the same trade."),
    ("JPM", "JPMorgan Chase &amp; Co.", "7.5%",
     "A quality financial with real exposure to the debt financing the CapEx cycle runs on, but "
     "broad enough not to live or die on it."),
    ("RARA11.SA", "Rare Earths / Critical Minerals ETF", "7.5%",
     "The other classification stretch I flag openly: a concentrated, policy-driven basket that "
     "tracks the same technology-materials cycle as the rest of the book, so in most states it "
     "does less true ballasting than its bucket label implies. The exception is an "
     "export-control shock, where it is the one line in the book that re-rates upward. It also "
     f"traded in only about {RARA_COVER} of the measured window, which limits how much its "
     "long-horizon return figures should be trusted."),
]:
    story.append(KeepTogether(position(*args)))

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
        "<b>Neocloud classification overlap.</b> NBIS and CRWV are functionally "
        "compute-infrastructure lessors, not power generators, and their high operational "
        "correlation compresses the 18-position book closer to 17 independent bets.", weakness),
    Paragraph(
        "<b>Ballast misclassification and liquidity drag.</b> RARA11.SA is assigned to Ballast "
        "but is correlated with the same technology-materials cycle the rest of the book is "
        f"long, and its thin trading history (~{RARA_COVER} active coverage in the measured "
        "window) adds noise to any long-horizon variance figure.", weakness),
    Paragraph(
        "<b>Temporal horizon mismatch.</b> Daily deviation tracking compares short-term market "
        "noise against a multi-year infrastructure lead-time thesis (permitting and transformer "
        "procurement run three to five years). Daily relative performance between Energy and "
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

# ============================================================== 5. RISK
story += [
    Paragraph("5. RISK FRAMEWORK", eyebrow),
    Paragraph("Scenario Stress-Testing", headline),
    Paragraph(
        "An empirical covariance matrix, estimated over a year of daily data across six "
        "currencies (one with three weeks of trading history), would look statistically rigorous "
        "while being almost entirely noise. The portfolio uses stated-assumption scenario shocks "
        "instead.", body),
]
grid_text = Paragraph(
    "Interconnection queues and transformer lead times, not chip supply, become the binding "
    "constraint; announced data-centre builds slip. Modelled portfolio impact "
    f"<b>{pct(grid['portfolio_pct'])}</b> (Energy {pct(grid_buckets.get('Energy', 0))}, "
    f"Compute {pct(grid_buckets.get('Compute', 0))}, Ballast {pct(grid_buckets.get('Ballast', 0))}). "
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
    "once. No point estimate is modelled for this scenario. The position sizing, not a forecast "
    "number, is the hedge.", body), Paragraph(
    "<b>Geopolitical Shock</b> (Taiwan Strait escalation): advanced foundry output is "
    "interrupted and export controls tighten on strategic materials. The tail scenario the "
    "portfolio is least hedged against: TSM, 2357.TW and ^KS11 all sit in the impact zone and "
    "are closer to one bet than three. RARA11.SA is the one line that works here, since the same "
    "export controls that interrupt foundry output bid rare earths up, but at 7.5% it cannot "
    "offset a Compute bucket four times its size. Also left unmodelled rather than assigned a "
    "manufactured number.", body)]

callout = Table([[Paragraph(
    "<b>Why stated assumptions instead of a fitted model.</b> A covariance matrix estimated "
    "from a year of daily data across six currencies would look statistically rigorous and "
    "would be almost entirely noise, given how little history several positions have. Stating "
    "one assumption directly and leaving the other two scenarios qualitative is less "
    "impressive-looking than assigning every scenario a precise number, and it is more honest "
    "about what the data can actually support.", body)]], colWidths=[R - L - 72])
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
                  "track record.", disc_body)]], colWidths=[R - L])
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
story += [Spacer(1, 14), disc]


def build(output=OUTPUT):
    doc = BaseDocTemplate(str(output), pagesize=letter,
                          title="Beyond the Hyper-Scalers: Independent Thematic Research",
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
