import os
import re
from contextlib import asynccontextmanager

import feedparser
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import Database

db = Database()

_BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", os.path.normpath(os.path.join(_BASE, "..", "frontend")))

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
_HEADERS = {
    "User-Agent": _UA,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class AddChannel(BaseModel):
    url: str

class AddFeed(BaseModel):
    url: str


# ── YouTube helpers ───────────────────────────────────────────────────────────

async def _rss_check(channel_id: str) -> tuple[bool, str]:
    """Fetch the channel RSS. Returns (ok, channel_name). ok=False means 404/empty."""
    rss = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(rss, headers=_HEADERS)
        if resp.status_code != 200:
            return False, ""
        feed = feedparser.parse(resp.text)
        title = feed.feed.get("title", "")
        if not title and not feed.entries:
            return False, ""
        return True, title
    except Exception:
        return False, ""


async def resolve_channel_id(url: str) -> tuple[str, str]:
    """Return (channel_id, channel_name). Raises ValueError with a helpful message on failure."""
    url = url.strip()

    # Case 0: user pasted the RSS feed URL directly
    m = re.search(r"feeds/videos\.xml\?channel_id=([a-zA-Z0-9_-]{20,})", url)
    if m:
        channel_id = m.group(1)
        ok, name = await _rss_check(channel_id)
        if ok:
            return channel_id, name or channel_id
        raise ValueError(f"RSS feed returned 404 for channel_id={channel_id}. The ID may be wrong.")

    # Case 1: direct /channel/UC... in the pasted URL
    m = re.search(r"youtube\.com/channel/([a-zA-Z0-9_-]{20,})", url)
    if m:
        channel_id = m.group(1)
        ok, name = await _rss_check(channel_id)
        if ok:
            return channel_id, name or channel_id
        raise ValueError(f"Could not load RSS for channel_id={channel_id} (404). Try the @handle URL instead.")

    # Normalize bare handles
    if not url.startswith("http"):
        url = "https://www.youtube.com/" + url.lstrip("/")

    print(f"[resolve] fetching page: {url}")
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        resp = await client.get(url, headers=_HEADERS)
    html = resp.text
    final_url = str(resp.url)
    print(f"[resolve] landed on: {final_url}  ({len(html)} bytes)")

    # Try each strategy, verify with RSS before accepting
    candidates: list[tuple[str, str]] = []  # (source, channel_id)

    # Strategy 1: RSS <link> tag embedded in page head (most trustworthy)
    for m in re.finditer(r"feeds/videos\.xml\?channel_id=([a-zA-Z0-9_-]{20,})", html):
        candidates.append(("rss-link-tag", m.group(1)))

    # Strategy 2: "externalId" field (YouTube uses this for the channel's own ID in JSON)
    for m in re.finditer(r'"externalId"\s*:\s*"([a-zA-Z0-9_-]{20,})"', html):
        candidates.append(("externalId", m.group(1)))

    # Strategy 3: "channelId" JSON field
    for m in re.finditer(r'"channelId"\s*:\s*"([a-zA-Z0-9_-]{20,})"', html):
        candidates.append(("channelId", m.group(1)))

    # Strategy 4: /channel/UC... in hrefs
    for m in re.finditer(r'youtube\.com/channel/([a-zA-Z0-9_-]{20,})', html):
        candidates.append(("href", m.group(1)))

    # Deduplicate preserving order
    seen: set[str] = set()
    unique = [(src, cid) for src, cid in candidates if not (cid in seen or seen.add(cid))]  # type: ignore

    print(f"[resolve] candidates ({len(unique)}): {unique[:8]}")

    for src, channel_id in unique:
        ok, name = await _rss_check(channel_id)
        print(f"[resolve]   {src} {channel_id} → ok={ok} name={name!r}")
        if ok:
            return channel_id, name or channel_id

    raise ValueError(
        "Could not find a working channel ID. All candidates returned 404 from YouTube's RSS. "
        "Workaround: on the channel page, Ctrl+U (View Source), search for 'channel_id=', "
        "copy the UC... value and paste it here directly."
    )


def _extract_video_id(entry) -> str:
    """Try every known location feedparser puts the YouTube video ID."""
    # 1. feedparser standard attribute for yt:videoId
    vid = entry.get("yt_videoid", "")
    if vid:
        return vid
    # 2. entry.id has format "yt:video:VIDEO_ID"
    m = re.search(r"yt:video:([a-zA-Z0-9_-]{6,})", entry.get("id", ""))
    if m:
        return m.group(1)
    # 3. watch URL in link or via fields
    for field in ("link", "feedburner_origlink"):
        m = re.search(r"[?&]v=([a-zA-Z0-9_-]{6,})", entry.get(field, ""))
        if m:
            return m.group(1)
    return ""


async def sync_channel(channel_id: str) -> int:
    """Fetch RSS, store videos. Returns count upserted. Never raises."""
    try:
        rss = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(rss, headers={"User-Agent": _UA})
        feed = feedparser.parse(resp.text)
        count = 0
        for entry in feed.entries[:20]:
            video_id = _extract_video_id(entry)
            if not video_id:
                continue
            title     = entry.get("title", "Untitled")
            thumbnail = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
            published = entry.get("published", "")
            db.upsert_video(channel_id, video_id, title, thumbnail, published)
            count += 1
        return count
    except Exception as exc:
        print(f"[sync_channel] {channel_id} failed: {exc}")
        return 0


# ── Blog RSS helpers ──────────────────────────────────────────────────────────

async def sync_feed(feed_id: int, url: str):
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        resp = await client.get(url)
    feed = feedparser.parse(resp.text)
    for entry in feed.entries[:20]:
        link = entry.get("link", "")
        if not link:
            continue
        title = entry.get("title", "Untitled")
        summary = entry.get("summary", "")
        content = ""
        if hasattr(entry, "content") and entry.content:
            content = entry.content[0].get("value", "")
        published = entry.get("published", "")
        db.upsert_article(feed_id, title, link, summary, content, published)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/debug/resolve")
async def debug_resolve(url: str):
    """Dry-run channel resolution — shows every candidate and RSS check result."""
    if not url.startswith("http"):
        url = "https://www.youtube.com/" + url.lstrip("/")

    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        resp = await client.get(url, headers=_HEADERS)
    html = resp.text

    candidates = []
    seen: set[str] = set()
    for label, pattern in [
        ("rss-link-tag", r"feeds/videos\.xml\?channel_id=([a-zA-Z0-9_-]{20,})"),
        ("externalId",   r'"externalId"\s*:\s*"([a-zA-Z0-9_-]{20,})"'),
        ("channelId",    r'"channelId"\s*:\s*"([a-zA-Z0-9_-]{20,})"'),
        ("href",         r'youtube\.com/channel/([a-zA-Z0-9_-]{20,})'),
    ]:
        for m in re.finditer(pattern, html):
            cid = m.group(1)
            if cid not in seen:
                seen.add(cid)
                ok, name = await _rss_check(cid)
                candidates.append({"source": label, "channel_id": cid, "rss_ok": ok, "name": name})

    return {
        "fetched_url": str(resp.url),
        "html_bytes": len(html),
        "candidates": candidates,
    }


@app.get("/api/channels")
def get_channels():
    return db.get_channels()


@app.post("/api/channels")
async def add_channel(body: AddChannel):
    try:
        channel_id, name = await resolve_channel_id(body.url)
    except Exception as e:
        raise HTTPException(400, str(e))
    if db.channel_exists(channel_id):
        raise HTTPException(409, "Channel already added")
    ch = db.add_channel(channel_id, name, body.url)
    ch["video_count"] = await sync_channel(channel_id)
    return ch


@app.delete("/api/channels/{channel_id}")
def delete_channel(channel_id: str):
    db.delete_channel(channel_id)
    return {"ok": True}


@app.get("/api/feeds")
def get_feeds():
    return db.get_feeds()


@app.post("/api/feeds")
async def add_feed(body: AddFeed):
    url = body.url.strip()
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url)
        feed = feedparser.parse(resp.text)
        if not feed.feed:
            raise ValueError("No feed data found — is this a valid RSS/Atom URL?")
        title = feed.feed.get("title", url)
    except Exception as e:
        raise HTTPException(400, str(e))
    if db.feed_exists(url):
        raise HTTPException(409, "Feed already added")
    f = db.add_feed(url, title)
    await sync_feed(f["id"], url)  # inline — articles ready immediately
    return f


@app.delete("/api/feeds/{feed_id}")
def delete_feed(feed_id: int):
    db.delete_feed(feed_id)
    return {"ok": True}


@app.get("/api/videos")
def get_videos():
    return db.get_videos()


@app.get("/api/articles")
def get_articles():
    return db.get_articles()


@app.post("/api/refresh")
async def refresh_all():
    for ch in db.get_channels():
        try:
            await sync_channel(ch["channel_id"])
        except Exception:
            pass
    for f in db.get_feeds():
        try:
            await sync_feed(f["id"], f["url"])
        except Exception:
            pass
    return {"videos": len(db.get_videos()), "articles": len(db.get_articles())}


@app.patch("/api/videos/{video_id}/watched")
def mark_watched(video_id: str):
    db.mark_video_watched(video_id)
    return {"ok": True}

@app.patch("/api/articles/{article_id}/read")
def mark_read(article_id: int):
    db.mark_article_read(article_id)
    return {"ok": True}


# Serve frontend — must be last
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")
