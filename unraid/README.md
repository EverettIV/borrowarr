# BorrowArr on Unraid

The **all-in-one** image runs the Next.js UI and Express API in a single container (`Dockerfile.all-in-one`). Use the Community Apps template in `community-apps/` for the Unraid GUI, or run the same layout with Compose.

## Docker Hub image (you publish)

From the repo root:

```bash
docker build -f Dockerfile.all-in-one -t YOUR_DOCKERHUB_USER/borrowarr:latest .
docker push YOUR_DOCKERHUB_USER/borrowarr:latest
```

Optional: multi-arch

```bash
docker buildx build -f Dockerfile.all-in-one \
  --platform linux/amd64 \
  -t YOUR_DOCKERHUB_USER/borrowarr:latest \
  --push .
```

The UI discovers the API at `http://<same-host-as-browser>:3013` when `NEXT_PUBLIC_API_URL` is not set at build time — no per-NAS image rebuild.

After publishing, set `<Repository>` in `community-apps/templates/borrowarr.xml` to `YOUR_DOCKERHUB_USER/borrowarr:latest`.

GitHub Actions: see `.github/workflows/docker-hub-publish.yml` (needs `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets).

## Manual install on Unraid (Docker template)

**Step-by-step sheet:** [`MANUAL-SETUP.md`](MANUAL-SETUP.md) (paths, ports, variables, qBittorrent, troubleshooting).

1. **Docker → Add Container →** paste a custom template, or install from Community Apps after you submit your CA repo.
2. Use paths like:
   - Appdata → `/app/data`
   - Media share → `/media`
   - Downloads share → `/downloads`
3. Publish **3012** (UI) and **3013** (API).
4. Add extra parameter: `--add-host=host.docker.internal:host-gateway` if download clients run on the host.

Reference compose (pull only, no build): `docker-compose.image.yml`.

## Community Apps submission

Community Apps expects a **dedicated public git repository** with files at the **repository root**, not nested under `unraid/`.

### 1. Create `borrowarr-unraid` (recommended name)

```bash
# new empty repo on GitHub, then:
cp -R unraid/community-apps/* /path/to/borrowarr-unraid/
cd /path/to/borrowarr-unraid
```

Edit `templates/borrowarr.xml`:

- `<Repository>` → your Docker Hub image (`youruser/borrowarr:latest`)
- `<Registry>` → `https://hub.docker.com/r/youruser/borrowarr`
- `<TemplateURL>` → raw URL of **this** file in **this** CA repo, e.g.  
  `https://raw.githubusercontent.com/EverettIV/borrowarr-unraid/main/templates/borrowarr.xml`

- `ca_profile.xml` must use `<CommunityApplications>` (not legacy `<Maintainer>`) and a descriptive `<Profile>` — see [Repository Info XML](https://ca.unraid.net/submit/help/repository-info-xml).

### 2. Add support links

Before submit, add an Unraid forums support thread (optional but common) and put the URL in `<Support>` if you prefer forums over GitHub issues.

### 3. Submit

1. Push the public CA repo.
2. Open [ca.unraid.net/submit/new](https://ca.unraid.net/submit/new).
3. Enter the repo URL → **Validate** → **Scan** → submit.

Docs: [Community Apps starter](https://github.com/unraid/unraid-community-apps-starter) · [Submission help](https://ca.unraid.net/submit/help)

### Icon

Canonical artwork: `data/borrowarr-icon-circle-no-bg.png` (circle, transparent). A copy ships in `unraid/community-apps/icon.png` for the CA repo bundle — refresh it after updating the `data/` file:

```bash
cp data/borrowarr-icon-circle-no-bg.png unraid/community-apps/icon.png
```

### Keeping in sync

When you change `unraid/community-apps/templates/borrowarr.xml` in the main BorrowArr repo, copy updates into your `borrowarr-unraid` repo (or automate with a small release script).

### Optional: nested local clone

You can keep the CA repo inside the app tree as its own git checkout (parent `.gitignore` lists `/borrowarr-unraid/`):

```bash
cd /path/to/borrowarr
git clone https://github.com/EverettIV/borrowarr-unraid.git borrowarr-unraid   # once
./scripts/sync-unraid-ca.sh
cd borrowarr-unraid && git add -A && git commit -m "Sync CA template" && git push
```

GitHub still has **two repos**; only your laptop stores them in one folder.

## Ports and paths

| Host port | Service |
|-----------|---------|
| 3012 | Web UI |
| 3013 | API |

| Container path | Purpose |
|----------------|---------|
| `/app/data` | SQLite + JWT |
| `/media` | `movies/`, `tv/` |
| `/downloads` | `movies/`, `tv/` for clients |

Set `BORROWARR_ENSURE_MEDIA_DIRS=true` only if you want the app to create those folders on startup.