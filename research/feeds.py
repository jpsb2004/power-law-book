"""
RSS ingestion. Published feeds only — no HTML scraping.

Three families, each with a different failure mode:

  google-news-rss  broad coverage, low precision. Query per entity, in the
                   language of its listing venue.
  sec-edgar-atom   authoritative for US filers. SEC's access policy requires a
                   User-Agent identifying the requester, and rate-limits to
                   ~10 req/s; both are honoured below.
  cvm-atom         the Brazilian regulator's news feed. Note this is CVM's own
                   announcements, NOT per-company filings: those live in the
                   RAD/ENET portal, which publishes no feed. Reaching them would
                   need a scraper, which is out of scope by design.

Every item carries its origin so the briefing can weight a regulator filing
differently from a news aggregator headline.
"""

from __future__ import annotations

import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import feedparser
import requests

from .ontology import Book, Entity, NewsItem, Source

# SEC requires a descriptive UA with contact details. A generic browser string
# gets blocked, and rightly so.
SEC_UA = "power-law-book research (jpsb2004@gmail.com)"
GENERIC_UA = "power-law-book/0.1 (+https://github.com/jpsb2004/power-law-book)"

GOOGLE_NEWS = "https://news.google.com/rss/search"
SEC_EDGAR = "https://www.sec.gov/cgi-bin/browse-edgar"
CVM_NEWS = "https://www.gov.br/cvm/pt-br/assuntos/noticias/RSS"

TIMEOUT = 20
MAX_ITEMS_PER_ENTITY = 6

# Venue -> (hl, gl, ceid) so a B3 listing is searched in Portuguese and a TWSE
# listing in English rather than everything defaulting to US news.
LOCALES = {
    "B3 São Paulo": ("pt-BR", "BR", "BR:pt"),
    "Tadawul": ("en-US", "US", "US:en"),
    "TWSE": ("en-US", "US", "US:en"),
    "KRX": ("en-US", "US", "US:en"),
    "LSE": ("en-GB", "GB", "GB:en"),
}
DEFAULT_LOCALE = ("en-US", "US", "US:en")

# Search terms per entity. The ticker alone is useless for names like "LB" or
# "AMD" in a news index, so each entity gets a disambiguating phrase.
QUERY_HINTS = {
    "NBIS": "Nebius AI cloud",
    "CRWV": "CoreWeave data center",
    "URA": "uranium mining supply",
    "NLR": "nuclear power utilities",
    "PETR4.SA": "Petrobras",
    "2222.SR": "Saudi Aramco",
    "LB": "LandBridge Permian land",
    "2357.TW": "ASUSTeK AI server",
    "^KS11": "Korea KOSPI semiconductor exports",
    "PLTR": "Palantir",
    "AINF.L": "AI infrastructure ETF",
    "AMD": "AMD data center GPU",
    "TSM": "TSMC foundry capacity",
    "VGT": "US technology sector",
    "RARA11.SA": "terras raras metais estratégicos",
    "GLD": "gold price central bank",
    "AVDV": "international small cap value",
    "JPM": "JPMorgan",
}

# CIK numbers for the US filers in the book. Only these have EDGAR filings;
# foreign listings and funds are skipped rather than queried pointlessly.
SEC_CIKS = {
    "PLTR": "0001321655",
    "AMD": "0000002488",
    "TSM": "0001046179",
    "JPM": "0000019617",
    "LB": "0002000178",
    "CRWV": "0001769628",
}


def _parse_date(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        value = getattr(entry, key, None)
        if value:
            return datetime.fromtimestamp(time.mktime(value), tz=timezone.utc)
    return None


def _fetch(url: str, ua: str) -> feedparser.FeedParserDict | None:
    """Fetch and parse one feed. Never raises — a dead feed is not fatal."""
    try:
        resp = requests.get(url, headers={"User-Agent": ua}, timeout=TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException:
        return None

    parsed = feedparser.parse(resp.content)
    # feedparser sets `bozo` on malformed XML but often still yields entries;
    # only treat it as failure when nothing was recovered.
    if parsed.bozo and not parsed.entries:
        return None
    return parsed


def google_news(entity: Entity, limit: int = MAX_ITEMS_PER_ENTITY) -> list[NewsItem]:
    hl, gl, ceid = LOCALES.get(entity.venue, DEFAULT_LOCALE)
    query = QUERY_HINTS.get(entity.ticker, entity.name)
    url = (
        f"{GOOGLE_NEWS}?q={urllib.parse.quote(query)}"
        f"&hl={hl}&gl={gl}&ceid={urllib.parse.quote(ceid)}"
    )

    parsed = _fetch(url, GENERIC_UA)
    if not parsed:
        return []

    items = []
    for entry in parsed.entries[:limit]:
        title = getattr(entry, "title", "").strip()
        if not title:
            continue
        # Google appends " - Publisher" to titles; split it into its own field.
        outlet = getattr(getattr(entry, "source", None), "title", "") or ""
        if not outlet and " - " in title:
            title, _, outlet = title.rpartition(" - ")
        items.append(
            NewsItem(
                title=title,
                link=getattr(entry, "link", ""),
                published=_parse_date(entry),
                source_name=outlet or "Google News",
                origin="google-news-rss",
            )
        )
    return items


def sec_filings(entity: Entity, limit: int = 4) -> list[NewsItem]:
    cik = SEC_CIKS.get(entity.ticker)
    if not cik:
        return []

    url = (
        f"{SEC_EDGAR}?action=getcompany&CIK={cik}&type=8-K&dateb=&owner=include"
        f"&count={limit}&output=atom"
    )
    parsed = _fetch(url, SEC_UA)
    if not parsed:
        return []

    items = []
    for entry in parsed.entries[:limit]:
        # EDGAR titles are boilerplate ("8-K - Current report"), which is
        # worthless as a citation. Stamp the filing date onto it so the item
        # identifies a specific document.
        raw_title = getattr(entry, "title", "Filing").strip()
        filed = _parse_date(entry)
        title = f"{raw_title} ({entity.ticker}, filed {filed:%d %b %Y})" if filed else raw_title
        items.append(
            NewsItem(
                title=title,
                link=getattr(entry, "link", ""),
                published=filed,
                source_name="SEC EDGAR",
                origin="sec-edgar-atom",
            )
        )
    return items


def cvm_news(limit: int = 6) -> list[NewsItem]:
    """
    Brazilian regulator announcements — book-level, not per-entity.

    CVM publishes no per-company filing feed, so this is attached to the book
    rather than pretending it is Petrobras-specific news.
    """
    parsed = _fetch(CVM_NEWS, GENERIC_UA)
    if not parsed:
        return []

    return [
        NewsItem(
            title=getattr(e, "title", "").strip(),
            link=getattr(e, "link", ""),
            published=_parse_date(e),
            source_name="CVM",
            origin="cvm-atom",
        )
        for e in parsed.entries[:limit]
        if getattr(e, "title", "").strip()
    ]


def collect(book: Book, workers: int = 6) -> dict[str, list[NewsItem]]:
    """
    Populate every entity's news, plus a book-level regulator feed.

    Feeds are fetched in parallel but bounded: SEC asks for well under 10
    requests a second, and a burst of 18 unthrottled requests is exactly the
    behaviour that gets an IP blocked.
    """
    retrieved = datetime.now(timezone.utc)

    def work(entity: Entity) -> tuple[str, list[NewsItem]]:
        items = google_news(entity)
        if entity.ticker in SEC_CIKS:
            time.sleep(0.15)  # stay well inside SEC's rate limit
            items = sec_filings(entity) + items
        return entity.ticker, items

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(pool.map(work, book.entities))

    for entity in book.entities:
        entity.news = results.get(entity.ticker, [])
        for item in entity.news:
            entity.sources.append(Source(item.origin, retrieved, item.link))

    return {"__book__": cvm_news(), **results}
