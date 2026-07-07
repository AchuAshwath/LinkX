# Spec: Session Management

> **Status:** 📝 Draft — under review
> **Depends on:** [browser-engine](./browser-engine.md)
> **Depended on by:** [platform-adapters](./platform-adapters.md)

## Problem

Browser-based auth means we deal with cookies, localStorage, and IndexedDB tokens rather
than OAuth access tokens. These sessions must persist across server restarts, be health-
checked before every automation task, and have a clear recovery path when they expire.

---

## Core Design Decisions (Research-Backed)

### Decision 1: `launch_persistent_context` over `storageState` JSON

Two approaches exist in Playwright for session persistence. After research, we use
`launch_persistent_context` exclusively.

| | `storageState` (JSON file) | `launch_persistent_context` (user_data_dir) ✅ |
|---|---|---|
| **What it saves** | Cookies + localStorage only | Everything: cookies, localStorage, IndexedDB, service workers, cache |
| **LinkedIn `JSESSIONID`** | ❌ Lost — session cookie, not persisted | ✅ Saved — stored in the profile dir |
| **Matches real browser?** | No — fresh fingerprint every load | Yes — identical to a real user's Chrome profile |

**Verdict:** `storageState` misses `IndexedDB` tokens that LinkedIn uses for auth. Sessions
drop unexpectedly after a few hours. `launch_persistent_context` captures everything.

> **macOS Keychain caveat:** On macOS, Chrome normally encrypts its cookie database via the
> system Keychain. Playwright-controlled Chrome processes are blocked from Keychain access by
> the OS (because they run under a debugger/CDP connection). The solution is to pass
> `--use-mock-keychain --password-store=basic` to **both** the login subprocess and the
> Playwright launch — this makes Chrome use a local profile-bound key instead. See
> [SESSION_BOOTSTRAP.md](../SESSION_BOOTSTRAP.md) for the full explanation.

### Decision 2: One `user_data_dir` Per Brand × Platform

Each connected account gets its own isolated directory. Cross-contamination between brands
or platforms is impossible.

```
sessions/
  brand_1/
    linkedin/     ← Chromium profile for brand_1 on LinkedIn
    x/            ← Chromium profile for brand_1 on X
  brand_2/
    linkedin/
    x/
```

The root `sessions/` directory is gitignored, never committed, and paths are stored in
`.env` not hardcoded.

### Decision 3: One Headed Login, Forever Headless

The user logs in **once** in a visible browser window (headed mode). The session is written
to disk. All future runs load the saved profile in headless mode — no login needed.

```
First run (headed, user visible):
  Launch browser with user_data_dir, headless=False
  User logs in, solves 2FA, ticks "Remember Me"
  Session saved automatically to user_data_dir
  Close browser

All future runs (headless, automated):
  Launch browser with same user_data_dir, headless=True
  Cookies + localStorage + IndexedDB all preloaded
  Platform sees a returning user, no challenge triggered
```

### Decision 4: Sentinel Health Check Before Every Task

We do NOT check sessions on a fixed schedule. We check immediately **before** every
automation task using a "sentinel element" pattern. This is more reliable than polling
because:
- Session expiry is event-driven (LinkedIn invalidates on suspicious activity), not time-based
- Unnecessary warmup loads increase bot detection risk

```
Before posting/scraping:
  1. Navigate to a low-risk profile page (not the compose page)
  2. Look for a known identity element (see per-platform table below)
  3. If found → session is healthy → proceed to task
  4. If not found → session expired → halt, alert, recovery flow
```

---

## Per-Platform Session Details

### LinkedIn

| Key Cookies | `li_at` (primary auth), `JSESSIONID` (session-bound) |
|---|---|
| **Session Lifespan** | `li_at` can last weeks under human-like usage; invalidated rapidly on datacenter IPs or automated patterns |
| **Sentinel Element** | `div[data-test-id="nav-current-user"]` or presence of user's name in the global nav |
| **Flagging URL** | `linkedin.com/checkpoint/challenge/` |
| **Flagging Text** | "security checkpoint", "unusual activity", "Let's do a quick security check" |

### X (Twitter)

| Key Cookies | `auth_token`, `ct0` (CSRF) |
|---|---|
| **Session Lifespan** | Can last months under normal usage; invalidated quickly on suspicious login patterns |
| **Sentinel Element** | `nav[aria-label="Primary navigation"]` or `a[data-testid="AppTabBar_Home_Link"]` |
| **Flagging URL** | `twitter.com/i/flow/login` or `twitter.com/account/access` |
| **Flagging Text** | "Help us keep Twitter safe", "Confirm your phone number", "Your account is suspended" |

---

## Implementation

### SessionManager

```python
# backend/app/services/browser/session.py
import json
from pathlib import Path
from rebrowser_playwright.async_api import async_playwright, BrowserContext

class SessionManager:
    def __init__(self, sessions_root: Path):
        self.sessions_root = sessions_root

    def session_dir(self, brand_id: str, platform: str) -> Path:
        path = self.sessions_root / brand_id / platform
        path.mkdir(parents=True, exist_ok=True)
        return path

    def session_exists(self, brand_id: str, platform: str) -> bool:
        """Check if a persistent session directory exists and is non-empty."""
        d = self.session_dir(brand_id, platform)
        return any(d.iterdir())

    async def launch_context(
        self,
        brand_id: str,
        platform: str,
        headless: bool = True,
    ) -> BrowserContext:
        """Launch a persistent browser context from the saved session dir.

        IMPORTANT — macOS Keychain:
            Pass --use-mock-keychain and --password-store=basic so that both
            the login subprocess (headed_login.py) and this Playwright context
            use the same local cookie encryption key. Without these flags,
            Playwright cannot decrypt cookies written by normal Chrome and loads
            an empty session. See docs/SESSION_BOOTSTRAP.md for details.
        """
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(self.session_dir(brand_id, platform)),
                headless=headless,
                channel="chrome",      # use installed Chrome for correct OS integration
                viewport={"width": 1280, "height": 800},
                ignore_default_args=["--enable-automation"],
                args=[
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                    "--use-mock-keychain",     # bypass macOS Keychain lock
                    "--password-store=basic",  # store key locally in profile dir
                ],
            )
            return context

### Integration with `browser-use`

When running high-level agents (like the content curation agent or self-healing tasks) via `browser-use`, we must bypass the default `browser-use` browser setup and inject our persistent session directory.

```python
# backend/app/services/browser/agent_integration.py
from browser_use import Browser, BrowserConfig, Agent
from app.services.browser.session import SessionManager

async def run_agent_with_session(
    session_manager: SessionManager,
    brand_id: str,
    platform: str,
    task: str,
    llm,
) -> str:
    """Run a browser-use agent using the brand's persistent session context."""
    user_data_dir = session_manager.session_dir(brand_id, platform)

    # Configure browser-use to load the persistent chromium profile
    browser = Browser(
        config=BrowserConfig(
            user_data_dir=str(user_data_dir),
            headless=True,
            # rebrowser-playwright is used under the hood via dependencies
        )
    )

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
    )

    try:
        history = await agent.run()
        return history.final_result()
    finally:
        await browser.close()
```
```

### Sentinel Health Check

```python
# backend/app/services/browser/health.py
from rebrowser_playwright.async_api import BrowserContext

SENTINELS = {
    "linkedin": {
        "url": "https://www.linkedin.com/feed/",
        "selector": "div[data-test-id='nav-current-user']",
        "flag_url_fragment": "checkpoint/challenge",
        "flag_texts": ["security checkpoint", "unusual activity", "quick security check"],
    },
    "x": {
        "url": "https://x.com/home",
        "selector": "nav[aria-label='Primary navigation']",
        "flag_url_fragment": "account/access",
        "flag_texts": ["Help us keep Twitter safe", "Confirm your phone number"],
    },
}

async def check_session_health(context: BrowserContext, platform: str) -> dict:
    """
    Returns {"healthy": True} or {"healthy": False, "reason": str, "screenshot": bytes}
    """
    config = SENTINELS[platform]
    page = await context.new_page()
    try:
        await page.goto(config["url"], wait_until="domcontentloaded", timeout=15_000)

        # Check for flagging URL
        if config["flag_url_fragment"] in page.url:
            shot = await page.screenshot()
            return {"healthy": False, "reason": "CHECKPOINT", "screenshot": shot}

        # Check for flagging text in page body
        body = await page.inner_text("body")
        for text in config["flag_texts"]:
            if text.lower() in body.lower():
                shot = await page.screenshot()
                return {"healthy": False, "reason": "FLAGGED", "screenshot": shot}

        # Check for sentinel (identity) element
        sentinel = await page.query_selector(config["selector"])
        if not sentinel:
            shot = await page.screenshot()
            return {"healthy": False, "reason": "NOT_LOGGED_IN", "screenshot": shot}

        return {"healthy": True}
    finally:
        await page.close()
```

---

## First-Time Login Flow (Headed Mode)

When a user connects a new social account in the UI:

1. **Backend** receives request: `POST /api/v1/accounts/connect` with `{brand_id, platform}`
2. **Backend** checks no Chrome instance is already running (singleton guard)
3. **Backend** launches a vanilla Chrome **subprocess** (not Playwright) with
   `--use-mock-keychain --password-store=basic --user-data-dir=sessions/{brand}/{platform}`
4. **Frontend** shows a "Complete login in the browser window that just opened" modal
5. **User** completes login + 2FA in the visible Chrome window
6. **User** waits ~10 seconds on the feed, then quits Chrome with `Cmd+Q`
7. **Backend** detects Chrome process exit and verifies `auth_token` cookie exists in the DB
8. **Backend** marks account as `connected` in the database
9. All future automation runs use `launch_persistent_context` with the same mock-keychain flags

> **Why a subprocess, not Playwright, for login?**
> X (and likely LinkedIn) detect the Chrome DevTools Protocol connection that Playwright
> opens and block login with an error. A vanilla `subprocess.run(chrome, ...)` has zero
> automation surface — X sees a completely normal browser.

> **Why must Chrome be quit with `Cmd+Q`?**
> Chrome only flushes its SQLite cookie database to disk on a clean shutdown. Closing just
> the window (`✕`) leaves Chrome running in the background on macOS; the cookie file may
> not be fully written until the process exits.

For Pi / server deployments with no physical display, we will expose the browser via a
**VNC session** (using `DISPLAY=:99 Xvfb :99` + `x11vnc`). The user connects via VNC
once to complete login. Implementation to be detailed in the deployment guide.

For the full step-by-step guide, see [SESSION_BOOTSTRAP.md](../SESSION_BOOTSTRAP.md).

---

## Security Rules

- `sessions/` directory is in `.gitignore` — never committed
- The path to `sessions/` root is set via `SESSION_STORAGE_PATH` env var
- Do NOT store platform passwords in the database — only the session cookies (via user_data_dir)
- If a user disconnects an account, delete its `user_data_dir` immediately
- Session dirs must be on the same physical machine as the running backend (no remote NFS)

---

## Open Questions

- [ ] How should the UI communicate "your LinkedIn session expired — please re-login" to
      the user? (Push notification? Email? In-app banner?)
- [ ] How do we handle the case where a VNC session is needed on a headless Pi for first-
      time login? (Separate `docker compose exec --env DISPLAY=:99` wrapper?)
- [ ] Should we store a `last_checked_at` timestamp per session in the DB for display in
      the account settings UI?
