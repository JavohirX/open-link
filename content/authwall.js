/**
 * LinkedIn Authwall Guard - Authwall Page Content Script
 *
 * Runs at document_start on *.linkedin.com/authwall*
 * Functions:
 * 1. Back button handling: If reached via Back button, skips authwall and continues back.
 * 2. Instant in-place replacement: Calls location.replace(targetUrl) in 0ms,
 *    eliminating the long-URL flash and preventing history stack trapping.
 * 3. Loop Guard: Tracks consecutive bounces in sessionStorage to halt Case B loops.
 */

(function () {
  // Prevent duplicate execution
  if (window.__liAuthwallGuardInjected) return;
  window.__liAuthwallGuardInjected = true;

  // -------------------------------------------------------------
  // 1. Back Button Detection: If user navigated Back into Authwall
  // -------------------------------------------------------------
  try {
    const navEntries = performance.getEntriesByType('navigation');
    const isBackForward = navEntries.length > 0 && navEntries[0].type === 'back_forward';
    if (isBackForward) {
      console.log('[AuthwallGuard] User navigated BACK to authwall. Continuing back...');
      window.history.back();
      return;
    }
  } catch {
    // Ignore performance timing errors
  }

  // -------------------------------------------------------------
  // 2. Extract and Validate sessionRedirect
  // -------------------------------------------------------------
  const parser = (typeof LinkedInUrlParser !== 'undefined') ? LinkedInUrlParser : null;
  const currentUrl = window.location.href;
  const targetUrl = parser
    ? parser.extractSessionRedirect(currentUrl)
    : fallbackExtractRedirect(currentUrl);

  if (!targetUrl) {
    return;
  }

  if (parser && !parser.isRestorableTarget(targetUrl)) {
    return;
  }

  // -------------------------------------------------------------
  // 3. Tab-Isolated Loop Guard (FR-5) via sessionStorage
  // -------------------------------------------------------------
  const normTarget = parser && parser.normalizeProfileUrl ? parser.normalizeProfileUrl(targetUrl) : targetUrl;
  const loopStorageKey = 'li_guard_attempt_' + normTarget;
  const canonicalStorageKey = 'li_guard_canonical_' + normTarget;
  let lastAttempt = 0;
  try {
    lastAttempt = parseInt(sessionStorage.getItem(loopStorageKey) || '0', 10);
  } catch {
    // Private mode / storage restricted
  }

  const now = Date.now();
  const isLoop = lastAttempt > 0 && (now - lastAttempt) < 30000;

  if (isLoop) {
    // Check if target is a regional LinkedIn subdomain (Case B Workaround)
    const canonicalUrl = parser ? parser.getCanonicalLinkedInUrl(targetUrl) : null;
    const normCanonical = canonicalUrl && parser && parser.normalizeProfileUrl
      ? parser.normalizeProfileUrl(canonicalUrl)
      : canonicalUrl;
    const hasTriedCanonical = (sessionStorage.getItem(canonicalStorageKey) === 'true') ||
                              (normCanonical && sessionStorage.getItem('li_guard_attempt_' + normCanonical) !== null);

    if (canonicalUrl && !hasTriedCanonical && parser && parser.isRestorableTarget(canonicalUrl)) {
      console.log('[AuthwallGuard] Regional authwall detected. Attempting canonical fallback:', canonicalUrl);
      try {
        sessionStorage.setItem(canonicalStorageKey, 'true');
        sessionStorage.setItem('li_guard_attempt_' + (normCanonical || canonicalUrl), String(now));
      } catch {}

      try {
        chrome.runtime.sendMessage({
          type: 'RECORD_CANONICAL_FALLBACK',
          originalUrl: targetUrl,
          canonicalUrl,
          authwallUrl: currentUrl
        });
      } catch {}

      window.location.replace(canonicalUrl);
      return;
    }

    // Case B confirmed: LinkedIn server redirected back to authwall. Halt redirect loop!
    console.warn('[AuthwallGuard] Loop detected for:', targetUrl);
    try {
      sessionStorage.removeItem(loopStorageKey);
      sessionStorage.removeItem(canonicalStorageKey);
      if (canonicalUrl) {
        sessionStorage.removeItem('li_guard_attempt_' + canonicalUrl);
        sessionStorage.removeItem('li_guard_canonical_' + canonicalUrl);
      }
      if (normCanonical) {
        sessionStorage.removeItem('li_guard_attempt_' + normCanonical);
        sessionStorage.removeItem('li_guard_canonical_' + normCanonical);
      }
    } catch {}

    showLoopBanner({
      targetUrl,
      canonicalUrl,
      isRegional: Boolean(canonicalUrl)
    });

    try {
      chrome.runtime.sendMessage({
        type: 'RECORD_LOOP_PREVENTED',
        targetUrl,
        canonicalUrl,
        authwallUrl: currentUrl
      });
    } catch {}
    return;
  }

  // Record this attempt in tab's session storage
  try {
    sessionStorage.setItem(loopStorageKey, String(now));
  } catch {}

  // -------------------------------------------------------------
  // 4. Instant In-Place History Replacement
  // -------------------------------------------------------------
  // CRITICAL: location.replace() REPLACES the current history entry
  // instead of pushing a new one. This ensures:
  // a) The browser Back button returns directly to Google search.
  // b) The long authwall URL does NOT linger for 1 second.
  try {
    chrome.runtime.sendMessage({
      type: 'RECORD_RESTORED',
      targetUrl,
      authwallUrl: currentUrl
    });
  } catch {}

  console.log('[AuthwallGuard] Instantly restoring profile in-place:', targetUrl);
  window.location.replace(targetUrl);

  // -------------------------------------------------------------
  // Fallback Helper Functions & Banner Rendering
  // -------------------------------------------------------------
  function fallbackExtractRedirect(urlStr) {
    try {
      const u = new URL(urlStr);
      const raw = u.searchParams.get('sessionRedirect') || u.searchParams.get('session_redirect');
      if (!raw) return null;
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }

  function extractSlugFallback(urlStr) {
    try {
      const u = new URL(urlStr);
      const match = u.pathname.match(/^\/in\/([^\/\?#]+)/i);
      return match ? decodeURIComponent(match[1].trim()) : '';
    } catch {
      return '';
    }
  }

  function injectBannerStyles() {
    if (document.getElementById('li-guard-banner-injected-style')) return;
    const style = document.createElement('style');
    style.id = 'li-guard-banner-injected-style';
    style.textContent = `
      #li-authwall-guard-banner {
        all: initial;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        box-sizing: border-box !important;
        position: fixed !important;
        top: 16px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: min(700px, 94vw) !important;
        max-width: 700px !important;
        background: #ffffff !important;
        border: 1px solid #d0d7de !important;
        border-left: 6px solid #0077b5 !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22) !important;
        border-radius: 10px !important;
        padding: 18px 22px !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        color: #1f2328 !important;
        animation: li-guard-slide-down 0.25s ease-out !important;
      }
      #li-authwall-guard-banner * {
        box-sizing: border-box !important;
        font-family: inherit !important;
      }
      @keyframes li-guard-slide-down {
        from { opacity: 0; transform: translate(-50%, -18px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .li-guard-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      .li-guard-title-group {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        font-weight: 700 !important;
        font-size: 15px !important;
        color: #0077b5 !important;
      }
      .li-guard-badge {
        background: #fff3cd !important;
        color: #856404 !important;
        border: 1px solid #ffeeba !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        padding: 2px 7px !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
      }
      .li-guard-badge-subdomain {
        background: #e1f0fa !important;
        color: #0077b5 !important;
        border: 1px solid #bde0f5 !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        padding: 2px 7px !important;
        font-weight: 600 !important;
        letter-spacing: 0.3px !important;
      }
      .li-guard-close {
        background: transparent !important;
        border: none !important;
        font-size: 22px !important;
        line-height: 1 !important;
        color: #656d76 !important;
        cursor: pointer !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
      }
      .li-guard-close:hover {
        background: #f6f8fa !important;
        color: #1f2328 !important;
      }
      .li-guard-body {
        font-size: 13px !important;
        line-height: 1.5 !important;
        color: #333d47 !important;
      }
      .li-guard-subtext {
        margin: 6px 0 0 0 !important;
        font-size: 12px !important;
        color: #57606a !important;
      }
      .li-guard-url {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace !important;
        background: #f6f8fa !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        border: 1px solid #e1e4e8 !important;
        word-break: break-all !important;
        color: #0969da !important;
        font-weight: 600 !important;
      }
      .li-guard-actions {
        display: flex !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        gap: 8px !important;
        margin-top: 4px !important;
      }
      .li-guard-btn {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        padding: 7px 13px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        text-decoration: none !important;
        border: 1px solid transparent !important;
        line-height: 1.2 !important;
        transition: all 0.15s ease !important;
      }
      .li-guard-btn-primary {
        background: #0a66c2 !important;
        color: #ffffff !important;
      }
      .li-guard-btn-primary:hover {
        background: #004182 !important;
      }
      .li-guard-btn-secondary {
        background: #f6f8fa !important;
        color: #24292f !important;
        border-color: #d0d7de !important;
      }
      .li-guard-btn-secondary:hover {
        background: #eaeef2 !important;
      }
      .li-guard-btn-accent {
        background: #0077b5 !important;
        color: #ffffff !important;
        border-color: #006097 !important;
      }
      .li-guard-btn-accent:hover {
        background: #005587 !important;
      }
      .li-guard-btn-link {
        background: transparent !important;
        color: #57606a !important;
        font-size: 12px !important;
        padding: 6px 8px !important;
        text-decoration: underline !important;
      }
      .li-guard-btn-link:hover {
        color: #0969da !important;
      }
    `;
    const targetHead = document.head || document.documentElement;
    if (targetHead) {
      targetHead.appendChild(style);
    }
  }

  function showLoopBanner(loopState) {
    if (document.getElementById('li-authwall-guard-banner')) return;

    injectBannerStyles();

    const target = loopState.targetUrl || 'the requested profile';
    const canonical = loopState.canonicalUrl;
    const isRegional = Boolean(loopState.isRegional);
    const escapedTarget = escapeHtml(target);
    const slug = (parser && parser.extractProfileSlug)
      ? parser.extractProfileSlug(target)
      : extractSlugFallback(target);
    const escapedSlug = escapeHtml(slug);

    let hostDomain = '';
    try {
      hostDomain = new URL(target).hostname;
    } catch {}

    const searchKeyword = escapedSlug ? `site:linkedin.com/in/${slug} OR "${slug}"` : (hostDomain ? `site:${hostDomain}` : target);
    const bingKeyword = escapedSlug ? `site:linkedin.com/in/${slug}` : target;

    const banner = document.createElement('div');
    banner.id = 'li-authwall-guard-banner';
    banner.innerHTML = `
      <div class="li-guard-header">
        <div class="li-guard-title-group">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>OpenLink</span>
          <span class="li-guard-badge">Case B: Restricted Profile</span>
          ${hostDomain && isRegional ? `<span class="li-guard-badge-subdomain">${escapeHtml(hostDomain)}</span>` : ''}
        </div>
        <button class="li-guard-close" id="li-guard-dismiss-btn" title="Dismiss">&times;</button>
      </div>
      <div class="li-guard-body">
        <div>The profile <span class="li-guard-url">${escapedTarget}</span> requires an active LinkedIn member login or is private. LinkedIn rejected public crawler access (HTTP 999). An infinite redirect cycle was safely prevented.</div>
        <p class="li-guard-subtext">Access this person's information without logging in using these public mirrors and search caches:</p>
      </div>
      <div class="li-guard-actions">
        <a class="li-guard-btn li-guard-btn-primary" href="https://archive.today/newest/${encodeURI(target)}" target="_blank" rel="noopener noreferrer" title="View historical public snapshot on Archive.today">
          Archive.today
        </a>
        <a class="li-guard-btn li-guard-btn-secondary" href="https://web.archive.org/web/*/${encodeURI(target)}" target="_blank" rel="noopener noreferrer" title="View Internet Archive snapshots">
          Wayback Machine
        </a>
        <a class="li-guard-btn li-guard-btn-secondary" href="https://www.google.com/search?q=${encodeURIComponent(searchKeyword)}" target="_blank" rel="noopener noreferrer" title="Search Google for indexed headline, experience & education text">
          Google Snippet
        </a>
        <a class="li-guard-btn li-guard-btn-secondary" href="https://www.bing.com/search?q=${encodeURIComponent(bingKeyword)}" target="_blank" rel="noopener noreferrer" title="Search Bing index for profile summary">
          Bing Search
        </a>
        ${canonical ? `
        <button class="li-guard-btn li-guard-btn-accent" id="li-guard-canonical-btn" title="Try canonical www.linkedin.com domain">
          Try Canonical (www)
        </button>` : ''}
        <button class="li-guard-btn li-guard-btn-secondary" id="li-guard-retry-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Retry
        </button>
        <button class="li-guard-btn li-guard-btn-link" id="li-guard-hide-btn">
          Proceed to LinkedIn Login
        </button>
      </div>
    `;

    function wireEvents() {
      document.getElementById('li-guard-dismiss-btn')?.addEventListener('click', () => banner.remove());
      document.getElementById('li-guard-hide-btn')?.addEventListener('click', () => banner.remove());
      document.getElementById('li-guard-retry-btn')?.addEventListener('click', () => {
        try {
          sessionStorage.removeItem(loopStorageKey);
          sessionStorage.removeItem(canonicalStorageKey);
          if (canonical) sessionStorage.removeItem('li_guard_attempt_' + canonical);
        } catch {}
        window.location.replace(target);
      });
      document.getElementById('li-guard-canonical-btn')?.addEventListener('click', () => {
        try {
          sessionStorage.removeItem(loopStorageKey);
          sessionStorage.removeItem(canonicalStorageKey);
          if (canonical) sessionStorage.removeItem('li_guard_attempt_' + canonical);
        } catch {}
        if (canonical) window.location.replace(canonical);
      });
    }

    function attach() {
      if (document.getElementById('li-authwall-guard-banner')) return;
      injectBannerStyles();
      const host = document.body || document.documentElement;
      if (host) {
        host.appendChild(banner);
        wireEvents();
      }
    }

    // Attempt initial attachment
    attach();

    // If body was not yet created at document_start, observe DOM until body is added and re-parent
    if (!document.body && document.documentElement) {
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          if (banner.parentElement && banner.parentElement !== document.body) {
            document.body.appendChild(banner);
          } else if (!document.getElementById('li-authwall-guard-banner')) {
            attach();
          }
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('li-authwall-guard-banner')) {
          attach();
        } else if (document.body && banner.parentElement !== document.body) {
          document.body.appendChild(banner);
        }
      }, { once: true });
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();

