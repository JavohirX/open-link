# Privacy Policy

_Last updated: 19 November 2026_

OpenLink is a browser extension that runs entirely in your browser. It has no server, no account system, no analytics and no ads. This page lists everything the extension stores, changes or sends.

## What the extension stores

All data stays on your device. None of it is sent to the developer or anyone else.

| Where | What | How long |
|---|---|---|
| Extension local storage (`chrome.storage.local`) | Your settings, two counters (profiles restored, loops prevented), and an activity log of the last 50 events. Each event holds a timestamp, the LinkedIn authwall URL and the LinkedIn profile URL involved. | Until you press **Clear** in the popup or remove the extension. |
| Extension session storage (`chrome.storage.session`) | Per-tab loop-guard state: tab ID, target profile URL and attempt timestamps. | Until the tab or browser is closed. |
| The LinkedIn tab's `sessionStorage` | Keys named `li_guard_attempt_<profile URL>` and `li_guard_canonical_<profile URL>`, used to detect redirect loops. | Until the tab is closed. |

The last row lives inside LinkedIn's own page storage, so LinkedIn's scripts on that tab can read those keys.

## What the extension changes

When you open a LinkedIn profile page (`linkedin.com/in/…` or `linkedin.cn/in/…`), the extension rewrites two headers on that page request:

- `User-Agent` is set to Bing's crawler user agent.
- `Referer` is set to `https://www.bing.com/`.

No other requests are modified. Your IP address and LinkedIn cookies are still sent as normal, so this does **not** hide who you are from LinkedIn.

Turning OpenLink off with the switch in its popup stops the header rewrite and stops its scripts from running on LinkedIn pages until you turn it back on.

## What the extension sends

The extension makes no network requests of its own: no `fetch`, `XMLHttpRequest`, WebSocket or beacon calls, and it does not load remote code.

If LinkedIn blocks a profile, the extension shows a banner with links to Archive.today, the Wayback Machine, Google Search and Bing Search. These links contain the profile URL or username. Nothing is sent unless you click one, and once you do, that site's own privacy policy applies.

## Permissions

| Permission | Why it is needed |
|---|---|
| `declarativeNetRequestWithHostAccess` | Rewrites the two headers above on LinkedIn profile page requests. |
| `scripting` | Turns the LinkedIn page scripts on and off with the popup's on/off switch. It can only target the LinkedIn hosts listed below. |
| `webNavigation` | Detects when the Back button lands on a LinkedIn authwall page, so it can skip past it. Only LinkedIn navigations are observed. |
| `storage` | Saves the settings, counters and activity log described above. |
| Host access to `*.linkedin.com` and `*.linkedin.cn` | Runs the content scripts on LinkedIn authwall and profile pages. The extension has no access to any other site. |

## Your controls

- **Clear** in the popup's Recent Interceptions section deletes the activity log.
- Removing the extension deletes everything it stored in extension storage.
- The source code is public, so you can check every claim on this page: <https://github.com/JavohirX/open-link>

## Contact

Questions or concerns: open an issue at <https://github.com/JavohirX/open-link/issues>.
