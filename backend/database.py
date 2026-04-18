import os
import sqlite3
from datetime import datetime

_default_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'noalgotube.db')
DB_PATH = os.environ.get('DB_PATH', os.path.normpath(_default_db))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  TEXT    UNIQUE NOT NULL,
    name        TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    added_at    TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS feeds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT    UNIQUE NOT NULL,
    title       TEXT    NOT NULL,
    added_at    TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  TEXT    NOT NULL,
    video_id    TEXT    UNIQUE NOT NULL,
    title       TEXT    NOT NULL,
    thumbnail   TEXT    NOT NULL,
    published   TEXT    NOT NULL,
    fetched_at  TEXT    NOT NULL,
    watched     INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id     INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    url         TEXT    UNIQUE NOT NULL,
    summary     TEXT,
    content     TEXT,
    published   TEXT    NOT NULL,
    fetched_at  TEXT    NOT NULL,
    is_read     INTEGER DEFAULT 0
);
"""


class Database:
    def __init__(self):
        self._db = None

    def _conn(self):
        if self._db is None:
            self._db = sqlite3.connect(DB_PATH, check_same_thread=False)
            self._db.row_factory = sqlite3.Row
        return self._db

    def init(self):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = self._conn()
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        self._migrate(conn)

    def _migrate(self, conn):
        for table, col in [("videos", "watched INTEGER DEFAULT 0"), ("articles", "is_read INTEGER DEFAULT 0")]:
            cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            col_name = col.split()[0]
            if col_name not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col}")

    # ── channels ──────────────────────────────────────────────────────────────

    def get_channels(self):
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM channels ORDER BY added_at DESC"
            ).fetchall()]

    def channel_exists(self, channel_id: str) -> bool:
        with self._conn() as conn:
            return conn.execute(
                "SELECT 1 FROM channels WHERE channel_id=?", (channel_id,)
            ).fetchone() is not None

    def add_channel(self, channel_id: str, name: str, url: str) -> dict:
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO channels (channel_id, name, url, added_at) VALUES (?,?,?,?)",
                (channel_id, name, url, now),
            )
        return {"channel_id": channel_id, "name": name, "url": url, "added_at": now}

    def delete_channel(self, channel_id: str):
        with self._conn() as conn:
            conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))
            conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))

    # ── feeds ─────────────────────────────────────────────────────────────────

    def get_feeds(self):
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM feeds ORDER BY added_at DESC"
            ).fetchall()]

    def feed_exists(self, url: str) -> bool:
        with self._conn() as conn:
            return conn.execute(
                "SELECT 1 FROM feeds WHERE url=?", (url,)
            ).fetchone() is not None

    def add_feed(self, url: str, title: str) -> dict:
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO feeds (url, title, added_at) VALUES (?,?,?)",
                (url, title, now),
            )
            return {"id": cur.lastrowid, "url": url, "title": title, "added_at": now}

    def delete_feed(self, feed_id: int):
        with self._conn() as conn:
            conn.execute("DELETE FROM feeds WHERE id=?", (feed_id,))
            conn.execute("DELETE FROM articles WHERE feed_id=?", (feed_id,))

    # ── videos ────────────────────────────────────────────────────────────────

    def get_videos(self):
        with self._conn() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT v.*, c.name AS channel_name
                FROM videos v
                JOIN channels c ON c.channel_id = v.channel_id
                ORDER BY v.published DESC
            """).fetchall()]

    def upsert_video(self, channel_id, video_id, title, thumbnail, published):
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO videos (channel_id, video_id, title, thumbnail, published, fetched_at)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(video_id) DO UPDATE SET
                    title=excluded.title,
                    thumbnail=excluded.thumbnail
            """, (channel_id, video_id, title, thumbnail, published, now))

    # ── articles ──────────────────────────────────────────────────────────────

    def get_articles(self):
        with self._conn() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT a.*, f.title AS feed_title
                FROM articles a
                JOIN feeds f ON f.id = a.feed_id
                ORDER BY a.published DESC
            """).fetchall()]

    def mark_video_watched(self, video_id: str):
        with self._conn() as conn:
            conn.execute("UPDATE videos SET watched=1 WHERE video_id=?", (video_id,))

    def mark_article_read(self, article_id: int):
        with self._conn() as conn:
            conn.execute("UPDATE articles SET is_read=1 WHERE id=?", (article_id,))

    def upsert_article(self, feed_id, title, url, summary, content, published):
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO articles (feed_id, title, url, summary, content, published, fetched_at)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(url) DO UPDATE SET
                    title=excluded.title,
                    summary=excluded.summary,
                    content=excluded.content
            """, (feed_id, title, url, summary, content, published, now))
