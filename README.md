# BorrowArr

BorrowArr is a self-hosted **movie and TV collection manager** for Usenet and BitTorrent users. It monitors titles you add, searches your configured indexers for releases, and interfaces with download clients to grab, sort, rename, and import files into your library. BorrowArr integrates with Torznab/Newznab indexers, download clients, Plex, and TMDb metadata.

BorrowArr does **not** provide, host, or index content. You connect your own indexers and download clients and are responsible for compliance with applicable law and third-party terms of service.

## Features

- **Media Discovery**: Browse and search for movies and TV shows using TMDb integration
- **Curated Lists**: TMDb-based curated list browsing
- **Indexer Integration**: Search across Torznab/Newznab indexers and Cardigann-style YAML definitions
- **Download Client Support**: Integrate qBittorrent, Transmission, SABnzbd, NZBGet, and similar clients
- **Automated Monitoring**: Monitor movies and TV series for new releases with quality profiles
- **Plex Integration**: Connect to Plex to view your library and get recommendations
- **Media Requests**: Request workflows with optional approval
- **User Management**: Multi-user support with role-based permissions
- **Parental Guides**: IMDb parental guide information
- **File Management**: Automatic file renaming and organization
- **Mobile Support**: Capacitor-based iOS/Android app support (in development)

## Tech Stack

### Client (Frontend)
- **Framework**: Next.js 15 with React 18
- **Styling**: Tailwind CSS, SCSS, HeroUI components
- **Authentication**: Firebase Auth
- **Language**: TypeScript
- **Mobile**: Capacitor for iOS/Android builds

### Server (Backend)
- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Database**: SQLite with Sequelize ORM
- **Authentication**: JWT (JSON Web Tokens)
- **Web Scraping**: Cheerio

## Project Structure

```
borrowarr/
├── client/                    # Next.js frontend application
│   ├── app/                   # App router pages and layouts
│   │   └── pages/             # Feature pages (discover, settings, etc.)
│   ├── components/            # React components
│   ├── context/               # Auth context providers
│   ├── hooks/                 # Custom React hooks
│   ├── styles/                # SCSS stylesheets
│   └── config/                # Site configuration
├── server/                    # Express.js backend API
│   ├── routes/                # API route handlers
│   ├── models/                # Sequelize database models
│   ├── services/              # Business logic services
│   │   ├── downloadClients/   # Download client integrations
│   │   └── listProviders/     # TMDb list providers
│   ├── scrapers/              # Cardigann-style indexer definitions
│   │   ├── definitions/       # YAML indexer definitions
│   │   └── engine/            # Scraper engine
│   ├── middleware/            # Express middleware (auth, etc.)
│   └── config/                # Database configuration
└── tunnels/                   # Cloudflare tunnel configuration
```

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** or **pnpm** package manager
- **SQLite** (bundled, no separate installation required)
- **Firebase Project** (for authentication)
- **TMDb API Key** (for media metadata)

### Optional
- **Prowlarr** (for additional indexer support via proxy)
- **FlareSolverr** (for Cloudflare-protected sites)
- **Plex Media Server** (for library integration)
- **Docker** (for containerized deployment)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/thefourthlion/borrowarr.git
cd borrowarr
```

### 2. Install Server Dependencies

```bash
cd server
npm install
# or with pnpm
pnpm install && pnpm rebuild sqlite3
```

### 3. Install Client Dependencies

```bash
cd ../client
npm install --legacy-peer-deps
# or with pnpm
pnpm install
```

### 4. Configure Environment Variables

Create `.env` files for both client and server (see [Configuration](#configuration) section below).

### 5. Start Development Servers

**Server** (from `/server` directory):
```bash
npm run dev
# Server runs on http://localhost:3013
```

**Client** (from `/client` directory):
```bash
npm run dev
# Client runs on http://localhost:3012
```

## Configuration

### Server Environment Variables

Create a `.env` file in the `/server` directory:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3013` | Server port |
| `JWT_SECRET` | **Yes** | - | Secret key for signing JWT access tokens |
| `JWT_REFRESH_SECRET` | **Yes** | - | Secret key for signing JWT refresh tokens |
| `JWT_ACCESS_EXPIRY` | No | `15m` | Access token expiry duration |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token expiry duration |
| `TMDB_API` | No | (bundled demo key) | **Your own** TMDb v3 API key (recommended for LAN/production). A shared demo key is used when unset so first-run works; rate limits are stricter when the demo key is active. |
| `TMDB_API_READ` | No | (bundled demo token) | Optional TMDb v4 read token; override in production if you use one. |
| `PROWLARR_URL` | No | - | Prowlarr instance URL for indexer proxy |
| `PROWLARR_API_KEY` | No | - | Prowlarr API key |
| `FLARESOLVERR_URL` | No | `http://localhost:8191` | FlareSolverr URL for Cloudflare bypass |
| `FLARESOLVERR_ENABLED` | No | `false` | Enable FlareSolverr integration |
| `API_BASE_URL` | No | `http://localhost:3013` | Base URL for internal API calls |
| `DEBUG_SCRAPER` | No | `false` | Enable verbose scraper logging |

### Client Environment Variables

Create a `.env` file in the `/client` directory:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | **Yes** | `http://localhost:3013` | Backend API URL |
| `NEXT_PUBLIC_SITE_URL` | No | - | Public site URL (e.g. `https://borrowarr.example.com`) for canonical links, Open Graph, and sitemap when indexing is enabled |
| `NEXT_PUBLIC_ALLOW_SEARCH_INDEXING` | No | `false` | Set to `true` only on a public demo/marketing deploy; keeps self-hosted instances out of search engines by default |
| `NEXT_PUBLIC_STRIPE_LINK_PREMIUM` | No | - | Stripe payment link for premium tier |
| `NEXT_PUBLIC_STRIPE_LINK_ULTIMATE` | No | - | Stripe payment link for ultimate tier |

### Firebase Configuration

The client uses Firebase for authentication. Firebase configuration is currently set in `/client/firebase.ts`. For production, you should:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication with your preferred providers (Email/Password, Google, etc.)
3. Update the Firebase config in `firebase.ts` with your project credentials

## Running with Docker

### Client

```bash
cd client
docker-compose up -d
# Runs on http://localhost:3012
```

### Server

```bash
cd server
docker-compose up -d
# Runs on http://localhost:3013
```

### Build Images Manually

**Client:**
```bash
cd client
docker build -t borrowarr-client .
docker run -p 3012:3012 borrowarr-client
```

**Server:**
```bash
cd server
docker build -t borrowarr-server .
docker run -p 3013:3013 borrowarr-server
```

## API Endpoints

The server exposes the following main API routes:

| Route | Description |
|-------|-------------|
| `/api/auth` | Authentication (login, register, refresh tokens) |
| `/api/Users` | User management |
| `/api/Search` | Search across configured indexers |
| `/api/Indexers` | Manage indexers |
| `/api/DownloadClients` | Manage download clients |
| `/api/TMDB` | TMDb movie/TV data proxy (**login required**; server-side cache + per-user rate limits) |
| `/api/MonitoredMovies` | Movie monitoring and automation |
| `/api/MonitoredSeries` | TV series monitoring and automation |
| `/api/Settings` | Application settings |
| `/api/Favorites` | User favorites |
| `/api/History` | Download history |
| `/api/PlexConnection` | Plex server integration |
| `/api/CuratedLists` | TMDb curated lists |
| `/api/MediaRequests` | User content requests |
| `/api/HiddenMedia` | Hidden/blocked content |
| `/api/ParentalGuide` | Parental guide information |
| `/api/Cardigann` | Custom scraper management |

## Adding Custom Indexers

BorrowArr supports custom indexer definitions using YAML files (Cardigann-style). See `/server/scrapers/README.md` for detailed documentation on creating custom indexer definitions.

Example YAML definition location: `/server/scrapers/definitions/`

## Scripts

### Server Scripts

| Script | Description |
|--------|-------------|
| `npm start` / `npm run dev` | Start the server with nodemon |
| `npm run migrate:user-id` | Run user ID migration |

### Client Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with Turbopack |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run cap:sync:ios` | Sync Capacitor iOS project |
| `npm run cap:run:ios` | Build and run on iOS |

## Deployment

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set, especially:
   - `JWT_SECRET` and `JWT_REFRESH_SECRET` (use strong, unique values)
   - `NEXT_PUBLIC_API_URL` (point to your production API)

2. **Database**: SQLite is suitable for small deployments. For larger installations, consider migrating to PostgreSQL or MySQL.

3. **Reverse Proxy**: Use nginx or Caddy as a reverse proxy with SSL termination.

4. **Docker**: Use the provided Docker configurations for consistent deployments.

### Cloudflare Tunnel (Optional)

A Cloudflare Tunnel configuration is provided in `/tunnels/docker-compose.yaml` for secure external access without opening ports. You'll need to:

1. Create a tunnel in Cloudflare Zero Trust dashboard
2. Replace the tunnel token in the configuration
3. Configure your DNS settings in Cloudflare

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style and conventions
- Write meaningful commit messages
- Update documentation for significant changes
- Test your changes locally before submitting

## Related Documentation

- `/server/README.md` - Server setup and API details
- `/server/scrapers/README.md` - Custom scraper development
- `/server/services/INDEXER_SEARCH_README.md` - Indexer search service documentation
- `/client/VALIDATION_REQUIREMENTS.md` - Pre-flight checks before queuing releases

## License

License: TBD

<!-- TODO: Add appropriate open-source license (MIT, GPL, etc.) -->

## Acknowledgments

- [TMDb](https://www.themoviedb.org/) for movie and TV metadata
- [Prowlarr](https://github.com/Prowlarr/Prowlarr) for Cardigann indexer definition format inspiration
- [HeroUI](https://heroui.com/) for UI components

---

## Disclaimer

BorrowArr is neutral management software, similar in role to other *Arr applications. It does not supply media, operate indexers, or run download clients for you. How you configure and use indexers and clients is your responsibility. The authors make no warranties and accept no liability for misuse. Use only with content and services you have the right to access, and in accordance with applicable law and third-party terms of service.
