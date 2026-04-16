<p align="center">
  <img src="frontend/assets/logo.png" width="96" alt="noalgotube">
</p>

# noalgotube

A personal content aggregator for YouTube channels and blog RSS feeds. No algorithm, no recommendations, only content from sources you explicitly add.

- **YouTube** — add channel URL (no API key required)
- **Blogs** — follows any RSS/Atom feed for blogs and news sites
- **Self-hosted** — your data stays on your machine or server

## Features

- Add YouTube channels by URL (`@handle`, `/channel/UC...`, `/user/...`)
- Add any blog RSS or Atom feed
- Filter by channel / feed or by date range
- Mark videos as watched, articles as read
- Grid and list view for videos
- Dark/light theme, persisted per browser
- Auto-refresh on a configurable interval
- Single Docker command to self-host

## Self-hosting with Docker (recommended)

**Requirements:** Docker and Docker Compose.

```bash
git clone https://github.com/iayanpahwa/noalgotube.git
cd noalgotube
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080).

Data is stored in a named Docker volume (`noalgotube_data`) so it survives container restarts and rebuilds.

To stop:
```bash
docker compose down
```

To update to a newer version:
```bash
git pull
docker compose up --build -d
```

### Expose on a custom port

Edit `docker-compose.yml` and change the port mapping:
```yaml
ports:
  - "3000:8080"   # host port : container port
```

## Local development

**Requirements:** Python 3.12+, [uv](https://github.com/astral-sh/uv).

```bash
cd backend
uv sync          # creates .venv and installs dependencies
uv run uvicorn main:app --reload --port 8080
```

Open [http://localhost:8080](http://localhost:8080).

The frontend is served as static files by FastAPI — no build step needed.

### Without uv

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

## Usage

1. **Manage** tab — add YouTube channels or blog RSS feeds
   - YouTube: paste any channel URL (`https://youtube.com/@name`, `/channel/UC...`, etc.)
   - Blogs: paste the RSS/Atom feed URL directly (`https://example.com/feed.xml`)
2. **Videos** tab — browse and watch videos; click a card to open the embedded player
3. **Blogs** tab — browse and read articles; click a card to open the article reader
4. **Refresh** button — manually sync all feeds for new content
5. **Auto-refresh** — configure in Manage to sync automatically while the page is open

## Configuration

Environment variables (set in `docker-compose.yml` or your shell):

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_DIR` | `../frontend` (relative to `main.py`) | Path to the frontend directory |
| `DB_PATH` | `../data/noalgotube.db` | Path to the SQLite database file |

Docker sets `DB_PATH=/data/noalgotube.db` automatically, mounted to the `noalgotube_data` volume.

## Stack

- **Backend:** Python 3.12, FastAPI, uvicorn
- **Database:** SQLite (no external DB required)
- **RSS:** feedparser + httpx
- **Frontend:** Vanilla HTML/CSS/JS — no npm, no build step

## License

MIT — see [LICENSE](LICENSE).
