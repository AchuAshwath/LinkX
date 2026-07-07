# Session Bootstrap Guide

> **Audience:** Developers setting up a LinkX instance for the first time, or adding a new social media account.

This guide explains how LinkX establishes and reuses persistent browser sessions for platform automation — no API keys, no OAuth, no bot blocks.

---

## Why Browser Sessions Instead of API Keys?

X (Twitter) and LinkedIn's public APIs are rate-limited, expensive, and increasingly restricted. Browser-based automation using a **persistent Chromium profile** mimics a real user's browser, giving us:

- Full access to the timeline, trends, and posting features
- No monthly API quota
- Session persistence — log in once, stay logged in for months

---

## How It Works: The Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1: LOGIN                           │
│                                                             │
│  headed_login.py ──► vanilla Chrome subprocess              │
│                       --use-mock-keychain                   │
│                       --user-data-dir=sessions/default/x    │
│                                                             │
│  User logs in manually. X sees: a normal Chrome browser.   │
│  Cookies are written to the user_data_dir profile.          │
└───────────────────────────┬─────────────────────────────────┘
                            │ sessions/default/x/Default/Cookies
                            │ (SQLite DB, encrypted with mock key)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                LAYER 2: VERIFY / SCRAPE / POST              │
│                                                             │
│  rebrowser-playwright ──► launch_persistent_context(        │
│                              user_data_dir=same dir,        │
│                              channel="chrome",              │
│                              --use-mock-keychain            │
│                           )                                 │
│                                                             │
│  Platform sees: a returning user's Chrome profile.          │
│  Cookies (auth_token, ct0, twid) loaded automatically.      │
└───────────────────────────┬─────────────────────────────────┘
                            │ reads feed / posts / scrapes trends
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 3: AUTOMATION                      │
│                                                             │
│  browser-use agent ──► injects persistent session           │
│  LangGraph pipeline       into task execution               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## The macOS Keychain Problem (And How We Solved It)

This is the most important thing to understand about our setup.

### The Problem

Chrome encrypts its cookie database using the **macOS Keychain**. This is a system-level security feature. When a process is being controlled via a debugger (which is exactly what Playwright's CDP connection is), macOS **blocks** that process from accessing the Keychain.

This means:

| Scenario | Cookie Access |
|---|---|
| Normal Chrome launched as user app | ✅ Full Keychain access, cookies encrypted/decrypted normally |
| Playwright controlling Chrome via CDP | ❌ Keychain blocked — falls back to a dummy encryption key |

The result: if you log in using vanilla Chrome (subprocess), then try to read the session via Playwright, Playwright loads **zero cookies** — it cannot decrypt them because they were encrypted by a different key.

### The Failed Approaches

1. **Logging in via Playwright directly** — X detects the CDP connection and shows `"Sorry, you are not allowed to log in at this time."` (X's bot detection is that good.)
2. **macOS singleton** — If Chrome is already running when you call `subprocess.run(chrome, --user-data-dir=...)`, Chrome merges the new window into the existing instance and **ignores** `--user-data-dir`. Cookies go to your personal profile, not ours.
3. **Forcing a fake User Agent** — X compares the User Agent in the cookie session against the current browser's identity and invalidates mismatches.

### The Solution: `--use-mock-keychain`

Pass `--use-mock-keychain` and `--password-store=basic` to **both** Chrome invocations (login subprocess and Playwright):

```
Chrome (subprocess login):  --use-mock-keychain --password-store=basic
Chrome (Playwright session): --use-mock-keychain --password-store=basic
```

With these flags, Chrome **skips** the macOS secure Keychain entirely and uses a **local, profile-bound key** stored inside the `user_data_dir` itself. Since both invocations use the same directory and the same mock key, they can read each other's cookies perfectly.

> **Security note:** The mock keychain key lives inside `sessions/`. This directory is gitignored. On a server, apply appropriate filesystem permissions (e.g. `chmod 700 sessions/`).

---

## Step-by-Step: First-Time Login

### Prerequisites

- Google Chrome installed at `/Applications/Google Chrome.app` (macOS)
- All other Chrome windows **fully closed** (`Cmd+Q`, not just window close)

### 1. Delete any existing broken session

```bash
rm -rf backend/sessions/default/x
```

### 2. Run the login script

```bash
cd backend
uv run python scripts/headed_login.py --platform x --brand-id default
```

The script:
1. Checks if Chrome is already running — **exits with error if it is** (the singleton guard)
2. Launches a fresh Chrome instance with `--use-mock-keychain --password-store=basic --user-data-dir=sessions/default/x`
3. Opens `https://x.com`
4. Waits for you to log in and complete 2FA manually

**Actions required in the Chrome window:**
1. Log in with your username/password
2. Complete any 2FA (phone, email, or authenticator)
3. Wait until you can see your home feed (tweets visible)
4. Wait an additional **~10 seconds** on the feed page
5. Press **`Cmd+Q`** to quit Chrome completely (or `File → Quit`, not just `✕` the window)

### 3. Verify the session was saved

```bash
sqlite3 backend/sessions/default/x/Default/Cookies \
  "SELECT host_key, name FROM cookies WHERE host_key LIKE '%x.com%';"
```

You should see `auth_token`, `ct0`, and `twid` in the output. If not, repeat Step 2.

### 4. Verify Playwright can load the session

```bash
uv run python scripts/test_session.py
```

Expected output:
```
[INFO] Cookies loaded into context: [..., 'auth_token', 'ct0', 'twid', ...]
[INFO] SUCCESS: You are logged in! Home feed detected.
[INFO] Found N tweets on your timeline:
[INFO] Tweet 1: ...
```

---

## Session Directory Structure

```
backend/sessions/               ← gitignored, never committed
  default/
    x/                          ← Chrome user_data_dir for X
      Default/
        Cookies                 ← SQLite DB with auth_token, ct0, twid
        IndexedDB/              ← X-specific app data
        Session Storage/
      Local State               ← Mock keychain encryption key lives here
      ...
    linkedin/                   ← Chrome user_data_dir for LinkedIn (future)
  brand_acme/
    x/                          ← Separate profile per brand
    linkedin/
```

---

## Using the Session in Automation (Playwright)

Always pass these flags when calling `launch_persistent_context`:

```python
from rebrowser_playwright.async_api import async_playwright
from pathlib import Path

async def get_x_context(brand_id: str = "default"):
    session_dir = Path("sessions") / brand_id / "x"
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(session_dir),
            headless=True,           # headless=True for production automation
            channel="chrome",        # use installed Chrome, not the downloaded Chromium
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--use-mock-keychain",        # ← REQUIRED on macOS
                "--password-store=basic",     # ← REQUIRED on macOS
            ],
        )
        return context
```

> **Why `channel="chrome"`?** This uses your installed Google Chrome app rather than the generic Playwright Chromium binary. The real Chrome binary has the correct code-signing and OS integration to use the mock keychain properly.

---

## Troubleshooting

### `Cookies loaded into context: []` (empty)

- **Cause:** Cookie decryption mismatch. The login session was encrypted with the real macOS Keychain, but Playwright cannot access it.
- **Fix:** Delete the session directory, ensure Chrome is quit, and re-run `headed_login.py` (which now passes `--use-mock-keychain`).

### `"Sorry, you are not allowed to log in at this time"`

- **Cause:** X detected CDP/automation on the login page. Playwright was used to drive the login.
- **Fix:** Always use `headed_login.py` (vanilla subprocess Chrome) for the initial login. Never use Playwright for login.

### `Google Chrome is already running!` error from `headed_login.py`

- **Cause:** Another Chrome window is open. macOS Chrome singleton would ignore `--user-data-dir`.
- **Fix:** Press `Cmd+Q` in Chrome to fully quit it, then re-run the script.

### Session works but expires after a few hours

- **Cause:** X invalidates sessions that show suspicious patterns (datacenter IP, bot-like behavior, rapid API calls).
- **Fix:** Run automation with human-like delays. On a server, use a residential proxy.

### Chrome window closed before you quit

If Chrome crashes or closes without `Cmd+Q`, some cookies may not have been flushed to disk. In this case, delete the session and start over.

---

## LinkedIn (Coming Soon)

The same approach applies for LinkedIn. The login script already supports it:

```bash
uv run python scripts/headed_login.py --platform linkedin --brand-id default
```

LinkedIn session cookies to look for: `li_at`, `JSESSIONID`.

---

## Security Checklist

- [x] `backend/sessions/` is in `.gitignore` — never committed
- [x] Sessions use mock keychain — no system Keychain dependency
- [ ] Set `chmod 700 backend/sessions/` on server deployments
- [ ] Rotate sessions if a brand account shows security alerts
- [ ] Delete session directory immediately when an account is disconnected
