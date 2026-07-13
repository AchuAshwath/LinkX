# LinkX – AI Agent × Platform Policy Research

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-AchuAshwath-ea4aaa?logo=github)](https://github.com/sponsors/AchuAshwath)

LinkX is an open‑source research platform that explores how AI‑powered social media agents interact with platform Terms of Service. It implements **direct browser automation** (System A) and is designing a contrasting **screen‑observation pipeline** (System B) to study the jurisdictional boundaries of platform automation policies.

As a working artifact, LinkX is also a fully functional self‑hosted social media scheduler — draft, schedule, and publish posts across platforms while retaining full control of your data and infrastructure.

> ⚠️ **Research use only.** This project exists to study and document the boundaries of platform automation policies. It is not intended to encourage or facilitate ToS violations. See [`ETHICS.md`](./ETHICS.md).

---

## Research Context

### The Question

When an AI agent reads your screen (via video capture + a vision model) and drafts content in a separate text editor — never touching the platform's DOM, API, or network layer — does that constitute "automation" under a platform's Terms of Service?

### The Short Answer

Current ToS frameworks define automation by **interface access method**, not by how intelligent the software is. This creates a policy vacuum around AI systems that operate entirely outside the platform's technical boundary while still producing platform‑directed output.

### Two Systems, One Thesis

| | System A | System B |
|---|---|---|
| **Approach** | Browser automation via Playwright | Screen observation via VLM + OCR |
| **Platform contact** | Yes — controls DOM directly | No — reads flat pixel frames |
| **ToS status** | Violates "any automated means" clauses | Jurisdictional gray area |
| **Detectable by platform** | Yes (with effort) | No |
| **Status** | ✅ Implemented | 💡 Planning / ideation |

**System A** (this repo) proves that even sophisticated evasion — CDP masking, Bézier mouse curves, humanized typing — doesn't change the legal classification. The ToS catches it regardless.

**System B** (in design) would demonstrate the observation gap: no ToS clause covers you reading your own screen with software.

For the full analysis, see [`docs/RESEARCH.md`](./docs/RESEARCH.md).

---

## The Software

LinkX is a real, working social media scheduler built with a modern full‑stack architecture.

### Technology Stack and Features

- ⚡ [**FastAPI**](https://fastapi.tiangolo.com) backend API.
  - 🧰 [SQLModel](https://sqlmodel.tiangolo.com) ORM over PostgreSQL.
  - 🔍 [Pydantic](https://docs.pydantic.dev) for data validation and settings.
  - 💾 [PostgreSQL](https://www.postgresql.org) as the database.
- 🚀 [React](https://react.dev) frontend.
  - TypeScript, hooks, [Vite](https://vitejs.dev), and modern tooling.
  - 🎨 [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) components.
  - 🧪 [Playwright](https://playwright.dev) for end‑to‑end testing.
  - 🦇 Built‑in dark mode support.
- 🐋 [Docker Compose](https://www.docker.com) for local and production deployments.
- 🔒 Secure password hashing and **JWT** authentication.
- 📫 Email‑based password recovery with [Mailcatcher](https://mailcatcher.me) in development.
- ✅ Tests with [Pytest](https://pytest.org).
- 📞 [Traefik](https://traefik.io) reverse proxy / load balancer (optional layouts).
- 🚢 Deployment docs for running LinkX as your own self‑hosted social scheduler.

### Social Integrations

- **LinkedIn member posting (self‑hosted)**:
  - Connect a personal LinkedIn account and publish or delete posts directly from LinkX.
  - Uses OAuth 2.0 with scopes `openid profile email w_member_social`.
  - Tokens are stored server‑side only in your deployment; no secrets are exposed to the browser.
  - See [`docs/LINKEDIN_SETUP.md`](./docs/LINKEDIN_SETUP.md) for step‑by‑step configuration.
- **Browser automation engine (System A)**:
  - Persistent sessions via real Chrome login (cookies, localStorage, IndexedDB).
  - `rebrowser-playwright` for CDP stealth, Bézier mouse curves, humanized typing.
  - 3‑tier self‑healing: hardcoded selectors → AI agent fallback → human alert.
  - See [`docs/specs/browser-engine.md`](./docs/specs/browser-engine.md).
- **Planned**:
  - X (Twitter) integration.
  - System B observation architecture (see [`docs/RESEARCH.md`](./docs/RESEARCH.md)).
  - Richer media workflows and cross‑posting, tracked in [`docs/specs/SOCIAL_MEDIA_INTEGRATION.md`](./docs/specs/SOCIAL_MEDIA_INTEGRATION.md).

### Screenshots

Captured from the app running locally (`bun run dev` in `frontend/`, dark theme): sign-in, home timeline, posts, and social personas.

<p align="center">
  <img src="img/login.png" alt="Log in – LinkX" width="49%" />
  <img src="img/timeline.png" alt="Home timeline – LinkX" width="49%" />
</p>
<p align="center">
  <img src="img/posts.png" alt="Posts – LinkX" width="49%" />
  <img src="img/social-accounts.png" alt="Social accounts and personas – LinkX" width="49%" />
</p>

---

## Quick start

```bash
git clone git@github.com:AchuAshwath/LinkX.git
cd LinkX
# Create and edit `.env` at the repo root (see development.md / deployment.md).
```

Typical local setup (see [`AGENTS.md`](./AGENTS.md) and [`development.md`](./development.md) for details):

- **Option A: Lightweight Hybrid Setup (Recommended)**
  Runs database & redis in Docker, but runs the frontend & backend code natively on the host. Fast hot-reloading and low memory/storage footprint.
  ```bash
  # 1. Create your local override configuration (.env.local is gitignored)
  echo -e "POSTGRES_SERVER=localhost\nREDIS_URL=redis://localhost:6379/0" > .env.local

  # 2. Spin up databases and launch both local dev servers
  bun run dev:local

  # 3. Validate and test your changes
  bun run check  # Static validation: Lint & Typecheck (frontend + backend)
  bun run test   # Run full test suite (frontend playwright + backend pytest)
  bun run verify # Run both check and test suites back-to-back
  ```

- **Option B: Full Docker Setup**
  Runs all services inside Docker Compose (includes watch mode for live sync).
  ```bash
  docker compose watch
  ```

Configure secrets in `.env` (`SECRET_KEY`, `FIRST_SUPERUSER_PASSWORD`, `POSTGRES_PASSWORD`, etc.) before a real deployment.

### Generate secret keys

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Documentation

| Topic | Location |
|--------|----------|
| **Research thesis** | [`docs/RESEARCH.md`](./docs/RESEARCH.md) |
| **Ethics & responsible use** | [`ETHICS.md`](./ETHICS.md) |
| Backend | [`backend/README.md`](./backend/README.md) |
| Frontend | [`frontend/README.md`](./frontend/README.md) |
| Deployment | [`deployment.md`](./deployment.md) |
| Local dev & tooling | [`development.md`](./development.md) |
| Agent / AI guidelines | [`AGENTS.md`](./AGENTS.md) |

Longer template-derived release notes (historical) live in [`release-notes.md`](./release-notes.md).

## Sponsor

If LinkX is useful to you, sponsorship helps maintain and grow the project:

**[github.com/sponsors/AchuAshwath](https://github.com/sponsors/AchuAshwath)**

The **Sponsor** button on this repository is configured via [`.github/FUNDING.yml`](./.github/FUNDING.yml).

## Acknowledgments

LinkX builds on patterns and code from the [FastAPI full-stack template](https://github.com/fastapi/full-stack-fastapi-template) and related ecosystem projects (MIT License). LinkX-specific features (personas, teams, LinkedIn integration, and social UI) are developed in this repository.

## License

See [`LICENSE`](./LICENSE) (MIT).
