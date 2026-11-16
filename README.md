# BorrowArr

BorrowArr is a self-hosted app for managing movies and TV: discover titles with TMDb, search your indexers, send grabs to a download client, monitor what you want, and organize files in your library.

It does **not** host or index media. You bring your own indexers and clients and use them lawfully and per their terms of service.

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **Indexer** | Torznab/Newznab URL (or add one via **Settings → Indexers**) |
| **Download client** | qBittorrent, Transmission, SABnzbd, NZBGet, etc., reachable from the BorrowArr **server** |
| **Media + download folders** | Configured in `server/.env` — see below |

**Pick one way to run the app:**

| Path | Requirements |
|------|----------------|
| **Docker (recommended)** | Docker Desktop (macOS/Windows) or Docker Engine + Compose (Linux) |
| **Manual** | Node.js **20+**, two terminals (server + client) |

Optional: your own [TMDb API key](https://www.themoviedb.org/settings/api) in `server/.env` (a demo key is used when unset).

---

## Media and download paths (`server/.env`)

BorrowArr needs **two roots** on the machine where the **server** runs. It derives four folders:

| Variable | Subfolders used by the app |
|----------|----------------------------|
| `BORROWARR_MEDIA` | `{MEDIA}/movies`, `{MEDIA}/tv` (library) |
| `BORROWARR_DOWNLOADS` | `{DOWNLOADS}/movies`, `{DOWNLOADS}/tv` (client / watcher) |

Point qBittorrent (or similar) at the same download tree — e.g. save path `{DOWNLOADS}` with categories `movies` and `tv`.

```bash
cp server/.env.example server/.env
```

Edit at least these (Docker defaults shown; on a **manual** install use **host** paths the server can access):

```bash
BORROWARR_MEDIA=/media
BORROWARR_DOWNLOADS=/downloads
BORROWARR_ENSURE_MEDIA_DIRS=true
```

Example **manual** install on macOS/Linux:

```bash
BORROWARR_MEDIA=/Users/you/borrowarr/media
BORROWARR_DOWNLOADS=/Users/you/borrowarr/downloads
BORROWARR_ENSURE_MEDIA_DIRS=true
```

JWT secrets are auto-generated on first server start if left blank in `.env`.

---

## Quick start (Docker)

### 1. Clone, env, and start

```bash
git clone https://github.com/thefourthlion/borrowarr.git
cd borrowarr
cp server/.env.example server/.env
# Confirm BORROWARR_MEDIA=/media and BORROWARR_DOWNLOADS=/downloads (defaults in .env.example)
docker compose up -d --build
```

First build can take a few minutes. Compose mounts host `./media` → `/media` and `./downloads` → `/downloads` and passes the same paths via env.

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3012 |
| API | http://localhost:3013 |

Logs:

```bash
docker compose logs -f borrowarr-server borrowarr-client
```

**Custom NAS paths:**

```bash
export BORROWARR_HOST_MEDIA=/mnt/nas/library
export BORROWARR_HOST_DOWNLOADS=/mnt/nas/incoming
docker compose up -d --build
```

**Networking:** The API runs in a container. Download client host must be reachable from there — e.g. `host.docker.internal` (Docker Desktop), LAN IP, or NAS hostname. If search works but grabs never hit the client, fix host/port first.

**Browser on another machine** — rebuild client with your API URL:

```bash
NEXT_PUBLIC_API_URL=http://your-host:3013 docker compose up -d --build
```

**Compose address-pool errors:** `docker network prune -f` — or on Linux: `docker compose -f docker-compose.host-network.yml up -d --build`.

### 2. First account

1. Open http://localhost:3012  
2. On a **fresh database**, use **register** and create the first account (admin).  
3. Public signups are off after the first user (**Users** page).

Reset everything:

```bash
docker compose down -v
docker compose up -d --build
```

### 3. Indexer → download client → monitoring

1. **Settings → Indexers** — add Torznab/Newznab, test, enable.  
2. **Settings → Download Clients** — add client, test, save. Default categories: **`movie`** and **`tv`**.  
3. **System** — optional **Automatic Grab** + check interval.  
4. Add titles from **Discover** / **Search**, or use **Requests**.

**File Management** should show `/media/movies`, `/media/tv`, `/downloads/movies`, `/downloads/tv` when env defaults are in place.

---

## Manual install (from scratch)

Run the API and UI on the host with Node **20+**. Use **host paths** in `server/.env` for `BORROWARR_MEDIA` and `BORROWARR_DOWNLOADS` (create the folders or set `BORROWARR_ENSURE_MEDIA_DIRS=true`).

### Server

```bash
cd borrowarr
cp server/.env.example server/.env
# Edit BORROWARR_MEDIA and BORROWARR_DOWNLOADS to your host paths

cd server
npm install
npm run dev
```

API: http://localhost:3013 (`npm run dev` uses nodemon). Production-style: `node index.js` after `npm run setup:env` if you need a one-off `.env` bootstrap.

### Client

In a **second terminal**:

```bash
cd borrowarr
cp client/.env.example client/.env
# NEXT_PUBLIC_API_URL=http://localhost:3013

cd client
npm install --legacy-peer-deps
```

**Development** (hot reload):

```bash
npm run dev
```

Web UI: http://localhost:3012

**Production-style** on the host:

```bash
npm run build
npm start
```

### After both are running

Same setup flow as Docker: register → indexer → download client → (optional) monitoring. The download client can use `localhost` because the server is not in Docker.

---

## Typical workflow

```text
Register (first run) → Indexer → Download client → Search or Request
                              ↘ Monitor list + Automatic Grab (optional)
```

- **Search** — query indexers and send a release to the client.  
- **Request / Monitor** — track titles; automatic grab searches and queues releases.  
- **History** — past grabs and import status.

---

## Optional server configuration

After editing `server/.env` (TMDb, Prowlarr, FlareSolverr, media paths):

```bash
# Docker
docker compose up -d --build borrowarr-server

# Manual — restart the server process
```

See `server/.env.example` for all keys.

---

## More documentation

| Topic | Location |
|-------|----------|
| Custom Cardigann indexers | `server/scrapers/README.md` |
| Indexer search behavior | `server/services/INDEXER_SEARCH_README.md` |
| Pre-flight checks (indexer + client) | `client/VALIDATION_REQUIREMENTS.md` |
| Cloudflare Tunnel (optional) | `tunnels/` |

---

## Contributing

Fork, branch, commit, and open a pull request. Match existing style and test locally when you can.

## License

License: TBD

## Disclaimer

BorrowArr is neutral management software, similar in role to other *Arr apps. It does not supply media, run indexers, or run download clients for you. You are responsible for lawful use and for complying with the terms of the services you connect.