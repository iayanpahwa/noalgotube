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
- Search videos and articles by title
- Filter by channel / feed or by date range
- Watch videos directly in-app via embedded player — no need to leave the page
- Mark videos as watched, articles as read — unread counts shown on nav tabs
- Grid and list view for videos
- Dark/light theme, persisted per browser
- Auto-refresh on a configurable interval
- Single Docker command to self-host

## Screenshots

![Videos](docs/screenshots/videos.jpg)

![Blogs](docs/screenshots/blogs.jpg)

![Manage](docs/screenshots/manage.jpg)

---

## Self-hosting

### Option 1 — Docker Hub (recommended, no clone needed)

Pull and run the pre-built image directly:

```bash
docker run -d \
  --name noalgotube \
  --restart unless-stopped \
  -p 8080:8080 \
  -v noalgotube_data:/data \
  iayanpahwa/noalgotube:latest
```

Open [http://localhost:8080](http://localhost:8080). Data is persisted in the `noalgotube_data` volume.

To update to the latest image:

```bash
docker pull iayanpahwa/noalgotube:latest
docker rm -f noalgotube
docker run -d --name noalgotube --restart unless-stopped \
  -p 8080:8080 -v noalgotube_data:/data iayanpahwa/noalgotube:latest
```

### Option 2 — Docker Compose with Docker Hub image

Create a `docker-compose.yml`:

```yaml
services:
  noalgotube:
    image: iayanpahwa/noalgotube:latest
    ports:
      - "8080:8080"
    volumes:
      - noalgotube_data:/data
    restart: unless-stopped

volumes:
  noalgotube_data:
```

Then run:

```bash
docker compose up -d
```

To update:

```bash
docker compose pull
docker compose up -d
```

### Option 3 — Build from source

```bash
git clone https://github.com/iayanpahwa/noalgotube.git
cd noalgotube
docker compose up --build -d
```

### Option 4 — Portainer

1. In Portainer, go to **Stacks → Add stack**
2. Name it `noalgotube`
3. Paste the compose snippet from Option 2 into the web editor
4. Click **Deploy the stack**
5. Open [http://your-host:8080](http://your-host:8080)

To update: go to the stack, click **Editor**, change `latest` to a specific version tag (e.g. `1.0.0`), and redeploy. Or pull the new image and restart the stack.

---

### Expose on a custom port

Change the port mapping in your compose file:

```yaml
ports:
  - "3000:8080"   # host port : container port
```

---

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

---

## Usage

1. **Manage** tab — add YouTube channels or blog RSS feeds
   - YouTube: paste any channel URL (`https://youtube.com/@name`, `/channel/UC...`, etc.)
   - Blogs: paste the RSS/Atom feed URL directly (`https://example.com/feed.xml`)
2. **Videos** tab — browse and watch videos; click a card to open the embedded player
3. **Blogs** tab — browse and read articles; click a card to open the article reader
4. **Search** — type in the search box on Videos or Blogs to filter by title
5. **Refresh** button — manually sync all feeds for new content
6. **Auto-refresh** — configure in Manage to sync automatically while the page is open

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
