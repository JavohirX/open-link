/**
 * LinkedIn Authwall Redirect Guard - Background Service Worker (MV3)
 *
 * Coordinates statistics, settings, loop guard synchronization,
 * and browser Back-button navigation handling.
 */

// Import modular utilities
importScripts('lib/url-parser.js', 'lib/loop-guard.js');

// Constants
const MAX_LOG_EVENTS = 50;
const DEFAULT_SETTINGS = {
  enabled: true,
  windowMs: 30000,
  maxAttempts: 1,
  autoDismissModals: true,
  showLoopBanner: true
};

// Initialize loop guard instance
const loopGuard = new LoopGuard({
  windowMs: DEFAULT_SETTINGS.windowMs,
  maxAttempts: DEFAULT_SETTINGS.maxAttempts
});

// Load persisted settings and restore session loop-guard state
async function initializeState() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    const effectiveSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    loopGuard.windowMs = effectiveSettings.windowMs;
    loopGuard.maxAttempts = effectiveSettings.maxAttempts;

    if (chrome.storage.session) {
      const { loopGuardState } = await chrome.storage.session.get('loopGuardState');
      if (loopGuardState) {
        loopGuard.fromJSON(loopGuardState);
      }
    }
  } catch (err) {
    console.error('[AuthwallGuard] State initialization error:', err);
  }
}

// Persist loop guard state to session storage
async function persistGuardState() {
  if (chrome.storage.session) {
    try {
      await chrome.storage.session.set({ loopGuardState: loopGuard.toJSON() });
    } catch {}
  }
}

// Record an audit/activity event locally (Privacy requirement: stored only in browser)
async function recordEvent(eventData) {
  try {
    const { recentEvents = [], stats = { restored: 0, loopsPrevented: 0 } } =
      await chrome.storage.local.get(['recentEvents', 'stats']);

    if (eventData.result === 'restored') {
      stats.restored = (stats.restored || 0) + 1;
    } else if (eventData.result === 'loop_prevented') {
      stats.loopsPrevented = (stats.loopsPrevented || 0) + 1;
    }

    const updatedEvents = [
      {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        timestamp: Date.now(),
        ...eventData
      },
      ...recentEvents
    ].slice(0, MAX_LOG_EVENTS);

    await chrome.storage.local.set({ recentEvents: updatedEvents, stats });
  } catch (err) {
    console.error('[AuthwallGuard] Error saving event:', err);
  }
}

// Set temporary badge on extension icon
function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 4000);
  } catch {}
}

// -----------------------------------------------------------------
// WebNavigation Event Listeners
// -----------------------------------------------------------------

// Listen when navigation commits to handle Back button traversal
chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId !== 0) return;

    const isBackForward = (details.transitionQualifiers && details.transitionQualifiers.includes('forward_back')) ||
                          details.transitionType === 'forward_back';

    // If user clicked Back and lands on Authwall, continue going back to exit to previous site (e.g. Google Search)
    if (isBackForward && isAuthwallUrl(details.url)) {
      console.log(`[AuthwallGuard] Back navigation reached authwall on tab ${details.tabId}. Skipping back...`);
      try {
        chrome.tabs.goBack(details.tabId);
      } catch {}
      return;
    }

    // Clean up / reset loop guard when tab successfully loads a normal profile or external page
    if (!isAuthwallUrl(details.url)) {
      const tabStatus = loopGuard.getTabStatus(details.tabId);
      if (tabStatus && tabStatus.status === 'restoring') {
        if (loopGuard.normalizeUrl(details.url) === tabStatus.targetUrl) {
          loopGuard.resetTab(details.tabId);
          persistGuardState();
        }
      }
    }
  },
  {
    url: [
      { hostContains: 'linkedin.com' },
      { hostContains: 'linkedin.cn' }
    ]
  }
);

// Clean up tab tracking when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  loopGuard.removeTab(tabId);
  persistGuardState();
  if (chrome.storage.session) {
    chrome.storage.session.remove(`tab_loop_${tabId}`).catch(() => {});
  }
});

// -----------------------------------------------------------------
// Message Passing Handler
// -----------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  if (message.type === 'RECORD_RESTORED') {
    setBadge('OK', '#057642');
    recordEvent({
      triggerSource: 'content_script_replace',
      authwallUrl: message.authwallUrl,
      targetUrl: message.targetUrl,
      result: 'restored',
      domain: new URL(message.targetUrl).hostname
    });
    if (tabId) {
      loopGuard.recordAttempt(tabId, message.targetUrl);
      persistGuardState();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RECORD_CANONICAL_FALLBACK') {
    setBadge('FALLBACK', '#f0ad4e');
    recordEvent({
      triggerSource: 'canonical_fallback',
      authwallUrl: message.authwallUrl,
      targetUrl: message.canonicalUrl,
      originalUrl: message.originalUrl,
      result: 'canonical_fallback',
      domain: new URL(message.canonicalUrl).hostname
    });
    if (tabId) {
      loopGuard.markCanonicalTried(tabId);
      loopGuard.recordAttempt(tabId, message.canonicalUrl);
      persistGuardState();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RECORD_LOOP_PREVENTED') {
    setBadge('LOOP', '#d9534f');
    recordEvent({
      triggerSource: 'loop_guard',
      authwallUrl: message.authwallUrl,
      targetUrl: message.targetUrl,
      canonicalUrl: message.canonicalUrl || null,
      result: 'loop_prevented',
      domain: new URL(message.targetUrl).hostname
    });
    if (tabId) {
      loopGuard.markLoopPrevented(tabId, message.targetUrl);
      persistGuardState();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_TAB_LOOP_STATE') {
    (async () => {
      if (!chrome.storage.session || !tabId) {
        sendResponse({ loopState: null });
        return;
      }
      try {
        const key = `tab_loop_${tabId}`;
        const data = await chrome.storage.session.get(key);
        sendResponse({ loopState: data[key] || null });
      } catch {
        sendResponse({ loopState: null });
      }
    })();
    return true;
  }

  if (message.type === 'RETRY_RESTORATION') {
    const target = message.targetUrl;
    if (tabId && target) {
      loopGuard.recordAttempt(tabId, target, Date.now() - DEFAULT_SETTINGS.windowMs);
      chrome.tabs.update(tabId, { url: target });
      sendResponse({ success: true });
    }
    return true;
  }

  if (message.type === 'GET_DIAGNOSTICS') {
    (async () => {
      const { settings = DEFAULT_SETTINGS, stats = {}, recentEvents = [] } =
        await chrome.storage.local.get(['settings', 'stats', 'recentEvents']);
      sendResponse({
        settings,
        stats,
        recentEvents,
        activeTabRecords: loopGuard.toJSON()
      });
    })();
    return true;
  }
});

// Initialize on service worker startup
initializeState();
