# OpenLink 🔓

> **Chrome MV3 extension that bypasses LinkedIn authwalls, unblurs profiles via Schema.org JSON-LD, and halts redirect loops. Zero telemetry.**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/tests-29%20passed-brightgreen.svg)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Zero Telemetry](https://img.shields.io/badge/telemetry-0%25%20(100%25%20local)-success.svg)](#privacy--security-guarantee)

---

## 🌟 Key Features

* 🚀 **Automatic Authwall Bypass:** Intercepts LinkedIn authwall redirects (`/authwall?sessionRedirect=...`) and restores the target profile seamlessly without forcing user login.
* 🤖 **DNR Crawler Spoofing:** Uses Chrome `declarativeNetRequest` header rules to simulate search crawler requests on profile routes, unlocking LinkedIn's full Server-Side Rendered (SSR) public HTML.
* 🔍 **Schema.org JSON-LD Unmasking:** Extracts embedded `@type: "Person"` metadata to automatically reconstruct masked asterisks (`****`) in job titles, institutions, and dates.
* 👁️ **Experience & Education Unblurring:** Automatically removes blurred overlay cards (*"View full experience"*), dismisses contextual login modals, and unlocks page scrolling.
* 🛡️ **Intelligent Loop Guard:** Tracks per-tab bounce timestamps in a 30-second sliding window to stop infinite redirect cycles when a profile is restricted by LinkedIn (Case B / HTTP 999).
* 🌐 **1-Click Public Mirrors:** When a private profile cannot be viewed on LinkedIn, provides instant one-click buttons for **Archive.today**, **Wayback Machine**, **Google Cache snippets**, and **Bing snippets**.
* 🔙 **Pristine History Stack:** Executes zero-latency `location.replace()` so the browser Back button returns directly to search results (Google, Bing, DuckDuckGo) without authwall traps.
* 🔒 **Strict Zero-Telemetry Privacy:** Operates 100% locally in your browser. No background analytics, no external servers, and zero telemetry transmissions.

---

## 🛠️ How It Works Under the Hood

```
[Profile Link Clicked]
        │
        ├──> DeclarativeNetRequest Rule (rules.json)
        │    • Sets Bingbot User-Agent & Referer for main_frame requests to ||linkedin.com/in/*
        │    • Signals LinkedIn's server to return full SSR public HTML
        │
        ├──> Content Script (content/profile.js)
        │    • Unblurs .blur & .blurred-content elements
        │    • Removes .blurred-overlay and container-raised popups
        │    • Restores masked asterisks from Schema.org JSON-LD person entity
        │
        └──> If Redirected to /authwall (content/authwall.js + lib/loop-guard.js)
             • Attempt 1: In-place location.replace() restores the profile
             • Regional Subdomain: Tries canonical www.linkedin.com fallback
             • Loop Prevented: Halts cycle & displays Case B fallback UI with Archive links
```

---

## 🚀 Installation (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/open-link.git
   ```
2. Open Google Chrome (or any Chromium browser like Brave, Edge, Opera).
3. Navigate to `chrome://extensions/` in the address bar.
4. Enable **Developer mode** in the top right corner.
5. Click **Load unpacked** in the top left corner.
6. Select the project folder.

---

## 🧪 Testing

OpenLink comes with a comprehensive automated test suite powered by Node.js native test runner:

```bash
npm test
```

### Test Coverage Highlights:
* **Acceptance Tests:** Authwall detection, parameter extraction, country subdomain preservation, Case B loop prevention, canonical fallback, and zero-telemetry audits.
* **Schema Unmasking:** Logo slug matching, multi-job handling, and positional index fallbacks.
* **Loop Guard Engine:** Sliding window expiry, tab isolation, and state persistence.
* **Navigation Handling:** Back-button traversal and HTTP 999 stub fast-forwarding.

---

## 📂 Project Structure

```
open-link/
├── manifest.json              # Chrome Manifest V3 configuration
├── rules.json                 # DeclarativeNetRequest header modification rules
├── background.js              # Background service worker (state, metrics & webNavigation)
├── lib/
│   ├── url-parser.js          # URL decoding, target validation, slug extraction
│   └── loop-guard.js          # Sliding-window redirect loop prevention state machine
├── content/
│   ├── authwall.js            # Authwall content script & Case B fallback banner
│   ├── authwall.css           # Styling for fallback banner
│   ├── profile.js             # Profile page enhancer (unblurrer & JSON-LD unmasker)
│   └── profile.css            # Styles for modal suppression & scroll unlocking
├── popup/
│   ├── popup.html             # Extension action popup interface
│   ├── popup.js               # Metric counters, threshold settings & activity logs
│   └── popup.css              # Modern popup styling
├── icons/                     # Extension icons (16, 32, 48, 128px)
├── tests/                     # Automated test suites
└── LICENSE                    # MIT License
```

---

## 🔒 Privacy & Security Guarantee

* **No Data Collection:** OpenLink never logs, stores, or transmits your browsing activity.
* **No External Network Calls:** The extension codebase is strictly audited to contain zero `fetch()`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon()` calls.
* **Open Redirect Defense:** Only validates and restores URLs that strictly match authentic LinkedIn domains (`*.linkedin.com`, `*.linkedin.cn`).

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
