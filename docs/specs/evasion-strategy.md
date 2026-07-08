# Evasion Strategy: Bot Detection & Bypasses (2025/2026)

This document outlines our strategy for automating interactions on highly defended social media platforms (X, LinkedIn) without triggering bans.

## The Legal Landscape

- **CFAA vs. ToS:** Scraping public web data is generally not a violation of the Computer Fraud and Abuse Act (CFAA), per cases like *hiQ v. LinkedIn*. However, logging into an account and automating actions violates the platform's Terms of Service (ToS).
- **Risk Assessment:** While not a federal crime, violating ToS constitutes a breach of contract. The primary risks are permanent account bans and IP blacklisting. We proceed by treating bot evasion as an operational necessity to preserve our accounts, not as a legal shield.

## Threat Model (Web Application Firewalls)

Modern WAFs (Cloudflare, DataDome, Akamai) detect bots at three layers:
1. **Network/TLS:** The "Client Hello" TLS fingerprint (JA3/JA4) of the connecting client.
2. **Browser Signals:** Javascript properties (`navigator.webdriver`), Plugins, and Hardware constraints (Hardware Concurrency, WebGL hashes).
3. **Behavioral Analysis:** Mouse movement patterns, typing speeds, and interaction intervals.

## Our Evasion Layers

### 1. CDP Leakage Protection (`rebrowser-playwright`)
Standard Playwright relies on the Chrome DevTools Protocol (CDP) and constantly fires `Runtime.enable` to listen to execution contexts. WAFs intercept this.
**Solution:** We use `rebrowser-playwright` which patches the C++ core of Chromium to suppress or mask the `Runtime.enable` signal, making the CDP connection invisible to page-level JavaScript.

### 2. TLS Fingerprinting Consistency
By using a real browser engine (Chromium) rather than a Python HTTP library (`requests` or `httpx`), our TLS fingerprint naturally matches the User-Agent we broadcast. We avoid simple mismatch detections natively.

### 3. JavaScript Stealth Injection (`stealth.min.js` approach)
Before any website JavaScript runs, we inject property overrides into every new page context.
**Implementation:** `backend/app/services/browser/actions.py -> inject_stealth`
- `navigator.webdriver = undefined`
- `navigator.plugins = [1, 2, 3, 4, 5]` (fake plugins array)
- `navigator.hardwareConcurrency = 8` (mask server CPUs)
- `window.chrome.runtime = {}` (spoof Chrome extensions)

### 4. Humanized Behavior (`actions.py`)
Teleporting the mouse or typing instantly triggers behavioral bans.
- **`human_click(page, selector)`**: Computes a bounding box and generates a randomized, multi-step Bezier-style path to the element before clicking.
- **`human_type(page, selector, text)`**: Varies keystroke delays to simulate human typing.
- **`human_navigation(page, url)`**: Avoids instant navigation loops.
- **`human_scroll(page, scrolls)`**: Triggers lazy-loading randomly.

## Future Hardening (If Scaling Required)
If we experience high ban rates, we must upgrade the infrastructure layer:
- **Residential Proxies:** Datacenter IPs (AWS, DigitalOcean) are heavily penalized.
- **Anti-Detect Browsers (BaaS):** Offloading automation to Scrapfly or Browserless to manage canvas/WebGL noise injection.
