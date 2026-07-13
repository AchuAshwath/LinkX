# Spec: Browser Automation Engine

> **Status:** 📝 Draft — under review
> **Depends on:** Nothing (foundation)
> **Depended on by:** [platform-adapters](./platform-adapters.md), [session-management](./session-management.md), [trending-topics](./trending-topics.md)
>
> **Research role:** This spec describes the core of **System A** — the "control case" in our comparative study. System A deliberately operates within the platform's technical boundary (DOM interaction via Playwright) to document what forensic artifacts are left behind and which ToS clauses are triggered. See [`RESEARCH.md`](../RESEARCH.md) §4.

## Problem

Social media APIs are expensive (X: $100+/mo) or painful to set up (LinkedIn OAuth). We need a browser automation layer that can authenticate, post, and scrape as if a real user were doing it. To run reliably on low-resource hardware like a Raspberry Pi, this layer must be extremely light, memory-efficient, and rock-solid against leaks.

---

## Architectural Decisions

### 1. Separation of Concerns (Dockerized Backend)
To keep the system lightweight and avoid heavy external dependencies:
*   **Embedded Playwright:** Playwright is installed directly inside our Python FastAPI container.
*   **Multi-Arch Support:** During Docker build, `playwright install --with-deps chromium` installs the correct ARM64 or AMD64 headless Chromium binary automatically.

### 2. Swappable Evasion Driver (Playwright ➔ nodriver)
To insulate the application from the anti-bot "arms race," we will decouple our automation logic from the browser driver.
*   **Primary Driver:** **`rebrowser-playwright`** (a patched version of Playwright that hides CDP/DevTools connection signatures to prevent detection by Cloudflare/Akamai).
*   **Secondary Driver (Fallback):** **`nodriver`** (an async, driverless library communicating directly over WebSocket port).
*   **Abstaction Layer:** The codebase will interact with a generic `BrowserContext` interface. If `rebrowser-playwright` starts getting flagged, we can swap the internal implementation to `nodriver` by updating a single environment variable (`BROWSER_DRIVER=nodriver`) without modifying any platform adapters or business logic.

### 3. On-Demand Lifecycle (No Persistent Pool)
Instead of keeping a browser running in memory 24/7 (which would consume ~300MB+ idle RAM on a Raspberry Pi), we use an **On-Demand Lifecycle**:
*   **Idle State:** Browser process is completely stopped. RAM usage is 0MB.
*   **Active State:** When a scheduled post is due, the backend spins up a browser context, connects, runs the automation, and immediately closes the context and disconnects.
*   **Sequential Execution:** The scheduler runs jobs one-by-one (sequentially). If multiple posts are due at the exact same time, they are queued and run in series. This prevents CPU and RAM spikes on the Pi.

### 4. Headless & Resource-Optimized Launch Arguments
The browser will launch in **headless mode** with aggressive optimization flags:
*   `--disable-gpu` (saves CPU/memory by avoiding GPU acceleration)
*   `--disable-dev-shm-usage` (prevents crashing in Docker containers due to `/dev/shm` size limits)
*   `--no-sandbox` (required inside Docker, safe since we only browse trusted social media platforms)
*   `--js-flags="--max-old-space-size=256"` (limits V8 engine memory usage)

---

## 3-Tier Execution & Self-Healing

Social media platforms frequently change their DOM structures. If we exclusively use LLM agents (like `browser-use`) for every action, the application becomes extremely slow and token-hungry. Instead, we use a 3-tier fallback architecture:

### Tier 1: Deterministic Fast-Path (Zero Tokens)
*   The system first attempts the task (e.g., posting a tweet) using known, hardcoded JSON selector paths (e.g., `selectors/x/post.json`).
*   This uses pure `rebrowser-playwright` commands. It is instant and costs zero AI tokens.
*   **Result:** 90% of the time, this succeeds. If a `TimeoutError` occurs (because the UI changed), it falls back to Tier 2.

### Tier 2: AI Self-Healing (Tokens Used Only on Breakage)
*   Upon a Tier 1 failure, the system spins up a **`browser-use` agent** (LangGraph).
*   The agent is given the goal (e.g., "Find the new post button and submit this text").
*   Because `browser-use` reads the actual page tree and reasons about elements, it bypasses the broken selectors and successfully completes the task.
*   **Crucial Step:** Before terminating, the agent is instructed to **extract and save the new working selectors** back to `selectors/x/post.json`. The script has now "healed" itself, and future runs will use Tier 1 again.

### Tier 3: Human Alert
*   If the `browser-use` agent fails (e.g., the platform radically changed its entire workflow, or a hard CAPTCHA block occurred), execution halts.
*   An alert is generated with a screenshot and sent to the user/developer via the dashboard.

---

## Anti-Detection & Flagging Management

To prevent user accounts from getting suspended, the system must proactively detect when it is being monitored or flagged, and stop automated actions immediately.

### 1. Common Flagging Signals

We will monitor the browser's navigation and page source for the following triggers:

| Platform | Flagging Indicator | Action Required |
|---|---|---|
| **LinkedIn** | Redirect to `linkedin.com/checkpoint/challenge/` | Immediate halt. Session invalid / CAPTCHA requested. |
| **LinkedIn** | Page text: "security checkpoint" or "unusual activity" | Immediate halt. |
| **X (Twitter)** | Redirect to `twitter.com/login/error` or verification screens | Immediate halt. |
| **X (Twitter)** | Page text: "Help us keep Twitter safe" or "Confirm your phone number" | Immediate halt. Account locked/restricted. |
| **Global** | HTTP Status Code `429` (Too Many Requests) | Backoff or pause automation for 24 hours. |

### 2. Proactive Verification (The "Warmup" Step)
Before executing a post or scraping run, the adapter must perform a silent "Warmup" page load:
1. Navigate to a low-risk page (e.g., the platform's home feed or user profile).
2. Check if the page contains any flagging indicators.
3. **If clear:** Proceed to compose/scrape.
4. **If flagged:**
   - Terminate the browser session immediately to avoid triggering a ban.
   - Take a screenshot of the block/verification page and save it to the host storage.
   - Update the post status to `failed` with error code `RECONNECTION_REQUIRED` or `VERIFICATION_REQUIRED`.
   - Send an alert/notification to the user dashboard containing the screenshot.

### 3. Human-in-the-Loop Verification Recovery
When automated authentication fails or a challenge is detected:
*   We **do not** attempt to automatically solve complex CAPTCHAs (which behaviorally flags the account further).
*   Instead, we prompt the user to re-authenticate or solve the challenge.
*   **Headed Mode Fallback:** Provide a command/UI action that launches the browser in *headed* (visible) mode on the host (for local runs) or exposes a VNC stream (for Docker/Pi runs), allowing the user to solve the verification challenge manually once. The new session cookies are then saved back to storage.

---

## Technical Specifications

### Unified Driver Interface
```python
from typing import Protocol, AsyncContextManager
from playwright.async_api import BrowserContext as PWContext

class BrowserContextProtocol(Protocol):
    """Abstract interface that wraps either Playwright or nodriver contexts."""
    async def goto(self, url: str) -> None: ...
    async def click(self, selector: str) -> None: ...
    async def type_text(self, selector: str, text: str) -> None: ...
    async def get_page_source(self) -> str: ...
    async def take_screenshot(self, path: str) -> None: ...
    async def close(self) -> None: ...


---

## Mandatory Evasion Principles (Stealth Rules)

To maintain account health and avoid detection, the browser automation engine must strictly adhere to the following rules:

### 1. No Datacenter IP Routing
*   **The Rule:** The browser engine must **never** route traffic directly from datacenter IP blocks (e.g., AWS EC2, DigitalOcean, Hetzner, Linode, OVH).
*   **The Reason:** Platforms like LinkedIn and X maintain comprehensive blacklists of datacenter IP ranges. Loading their login pages from these IPs instantly flags the session or triggers an unsolvable challenge.
*   **Implementation:**
    *   If hosted on a home network (Raspberry Pi or personal laptop), direct routing is permitted since residential IPs have high trust scores.
    *   If hosted on a cloud VPS (e.g., DigitalOcean, Hetzner), the engine **must** be configured to route traffic through high-quality residential or mobile proxies.

### 2. No Short-Lived Incognito Sessions
*   **The Rule:** The engine must **never** perform a fresh username/password login for every automated task using standard ephemeral incognito profiles.
*   **The Reason:** Logging in from scratch in a headless, empty-cache browser repeatedly is a high-risk signature. Real users stay logged in for days or weeks.
*   **Implementation:** We must use **cookie ageings / persistent context directories**. We perform a headed login once to solve challenges and establish the session, then reuse the saved `localStorage`, cookies, and IndexedDB state indefinitely. The browser context is loaded, the task is performed, and the context is closed without logging out.

### 3. Non-Linear Inputs & Action Jitter (Humanization)
All automated user interactions must avoid mechanical patterns:
*   **Typing:** Typing must be simulated key-by-key with a randomized delay (e.g., between `50ms` and `180ms` per character), rather than instant value filling. Add occasional pauses (e.g., `500ms` after punctuation marks) to simulate natural thinking.
*   **Mouse Movements:** Avoid teleporting the cursor or moving in perfectly straight lines (linear interpolation). Mouse paths must use curved paths (e.g., Bezier curves) with randomized deceleration as the cursor approaches target elements.
*   **Scrolling:** Scrolling must be done in erratic increments (e.g., scroll down 300px, wait 800ms, scroll down 150px, scroll up 50px) to mimic a user scanning a page, rather than smooth programmatic scroll-to-bottom actions.
*   **Jitter (Randomized Delays):** Every action (clicks, tab switches, navigations) must be padded with randomized wait times. Never perform actions on a precise schedule (e.g., clicking exactly 1.000 seconds after page load).

```
