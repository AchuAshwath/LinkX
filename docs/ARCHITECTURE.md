# LinkX — System Architecture

> **Status:** Draft — to be discussed and finalized

## Vision

LinkX is an AI-powered social media agent that discovers trending topics, curates daily posts matching your brand voice, and publishes them automatically — no expensive API keys required.

## Tech Stack

### Backend
| Layer | Technology | Why |
|-------|-----------|-----|
| **API Framework** | FastAPI (Python) | Async, typed, existing codebase |
| **Database** | PostgreSQL | Existing, relational data |
| **Cache / Queues** | Redis | Existing, session state + job queues |
| **Browser Automation** | Playwright (Python) | Auth, posting, scraping — no API keys needed |
| **AI Orchestration** | LangGraph | Stateful agent workflows, human-in-the-loop |
| **AI Chains/Tools** | LangChain | Prompt chains, output parsing, tool integrations |
| **LLM Provider Layer** | LiteLLM (via `langchain-litellm`) | One interface → any LLM provider |
| **Background Jobs** | APScheduler | In-process scheduler, Redis-locked for multi-worker |
| **Migrations** | Alembic | Existing |

### Frontend
| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | React + Vite | Existing codebase |
| **Routing** | TanStack Router (file-based) | Existing |
| **Data Fetching** | TanStack Query | Existing |
| **UI Components** | shadcn/ui + custom | Existing |

### Infrastructure
| Layer | Technology | Why |
|-------|-----------|-----|
| **Containers** | Docker Compose | Existing (Postgres, Redis, Playwright) |
| **Dev Workflow** | Hybrid: Docker services + local apps | Existing (`bun run dev:local`) |

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Frontend (Vite)                        │
│  Dashboard · Draft Inbox · Calendar · Brand Config · Settings       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP/REST
┌───────────────────────────────▼─────────────────────────────────────┐
│                        FastAPI Backend                               │
│                                                                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ API      │  │ AI Agent     │  │ Scheduler    │  │ Browser    │  │
│  │ Routes   │  │ Service      │  │ Service      │  │ Engine     │  │
│  │          │  │              │  │              │  │            │  │
│  │ • Posts  │  │ • LangGraph  │  │ • APScheduler│  │ • Playwright│ │
│  │ • Brands │  │ • LangChain  │  │ • Job queue  │  │ • Adapters │  │
│  │ • Auth   │  │ • LiteLLM    │  │ • Retry/lock │  │ • Sessions │  │
│  │ • Admin  │  │ • Curation   │  │              │  │            │  │
│  └──────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
│                                                                      │
│  ┌───────────────────┐  ┌───────────────────┐                       │
│  │ PostgreSQL        │  │ Redis             │                       │
│  │ • Users/Brands    │  │ • Browser sessions│                       │
│  │ • Posts/Drafts    │  │ • Job locks       │                       │
│  │ • Trending topics │  │ • Cache           │                       │
│  └───────────────────┘  └───────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Relationships

```mermaid
graph TD
    FE[Frontend] -->|REST API| API[API Routes]
    API --> AI[AI Agent Service]
    API --> SCHED[Scheduler Service]
    API --> BROWSER[Browser Engine]

    AI -->|LangGraph workflow| LITELLM[LiteLLM → Any LLM]
    AI -->|reads| TRENDS[Trending Topics]
    AI -->|writes| DRAFTS[Draft Posts]

    SCHED -->|triggers| BROWSER
    SCHED -->|reads| QUEUE[Post Queue]

    BROWSER -->|uses| ADAPTERS[Platform Adapters]
    ADAPTERS --> LI[LinkedIn Adapter]
    ADAPTERS --> X[X/Twitter Adapter]
    ADAPTERS --> TH[Threads Adapter]

    BROWSER -->|persists| SESSIONS[Session Store]

    TRENDS -->|scraped by| BROWSER

    subgraph Storage
        PG[(PostgreSQL)]
        REDIS[(Redis)]
    end

    AI --> PG
    SCHED --> PG
    SCHED --> REDIS
    SESSIONS --> REDIS
    BROWSER --> PG
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Browser over APIs | Playwright headless | X API costs $100+/mo, LinkedIn OAuth is painful. Browser automation is free. |
| LiteLLM over direct SDKs | `langchain-litellm` | User brings their own provider. Zero vendor lock-in. |
| LangGraph over raw chains | Stateful agent graphs | Human-in-the-loop review, complex multi-step curation workflows. |
| APScheduler over Celery | In-process scheduler | Simpler for single-instance. Redis lock for multi-worker. Celery is overkill at this stage. |
| Persona → Brand (UI only) | UI rename, keep model name | Avoids migration churn. Backend says `Persona`, frontend says `Brand`. |

## Open Decisions

- [ ] Should the Playwright browser run in the same container as FastAPI, or a separate one?
- [ ] How to handle platforms that require 2FA during browser login?
- [ ] Should we support image/media posts from day 1, or text-only first?
- [ ] Where to store browser session data — Redis, encrypted files, or Postgres?
