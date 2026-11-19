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

// Content scripts are registered here instead of in manifest.json so that the
// popup's on/off switch can stop them from running at all.
const CONTENT_SCRIPTS = [
  {
    id: 'authwall',
    matches: ['*://*.linkedin.com/authwall*', '*://*.linkedin.cn/authwall*'],
    js: ['lib/url-parser.js', 'content/authwall.js'],
    css: ['content/authwall.css'],
    runAt: 'document_start'
  },
  {
    id: 'profile',
    matches: ['*://*.linkedin.com/in/*', '*://*.linkedin.cn/in/*'],
    js: ['content/profile.js'],
    css: ['content/profile.css'],
    runAt: 'document_start'
  }
];
const RULESET_IDS = chrome.runtime.getManifest().declarative_net_request.rule_resources.map((r) => r.id);

// Initialize loop guard instance
const loopGuard = new LoopGuard({
  windowMs: DEFAULT_SETTINGS.windowMs,
  maxAttempts: DEFAULT_SETTINGS.maxAttempts
});

let extensionEnabled = true;
let applyQueue = Promise.resolve();

// Turns the header rules and content scripts on or off. Calls are queued so that
// quick toggles cannot interleave register/unregister. `refresh` re-registers the
// scripts from scratch (used after install/update so definitions are never stale).
function applyEnabledState(enabled, { refresh = false } = {}) {
  applyQueue = applyQueue.then(async () => {
    extensionEnabled = enabled !== false;
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets(
        extensionEnabled ? { enableRulesetIds: RULESET_IDS } : { disableRulesetIds: RULESET_IDS }
      );
      let registeredIds = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
      if ((refresh || !extensionEnabled) && registeredIds.length) {
        await chrome.scripting.unregisterContentScripts({ ids: registeredIds });
        registeredIds = [];
      }
      if (extensionEnabled) {
        const missing = CONTENT_SCRIPTS.filter((s) => !registeredIds.includes(s.id));
        if (missing.length) await chrome.scripting.registerContentScripts(missing);
      }
    } catch (err) {
      console.error('[AuthwallGuard] Failed to apply enabled state:', err);
    }
  });
  return applyQueue;
}

// Load persisted settings and restore session loop-guard state
async function initializeState() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    const effectiveSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    loopGuard.windowMs = effectiveSettings.windowMs;
    loopGuard.maxAttempts = effectiveSettings.maxAttempts;
    await applyEnabledState(effectiveSettings.enabled);

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
    // Checked synchronously: awaiting startup here delayed tabs.goBack enough to
    // overshoot history (measured 10/21 vs 3/26 runs). After a cold start this is
    // `true` until settings load, which matches the previous behaviour.
    if (!extensionEnabled) return;

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

// Apply settings changed from the popup (on/off switch, loop thresholds)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const effectiveSettings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
  loopGuard.windowMs = effectiveSettings.windowMs;
  loopGuard.maxAttempts = effectiveSettings.maxAttempts;
  applyEnabledState(effectiveSettings.enabled);
});

// After install or update, re-register content scripts so their definitions match this version
chrome.runtime.onInstalled.addListener(() => {
  ready.then(() => applyEnabledState(extensionEnabled, { refresh: true }));
});

// Initialize on service worker startup
const ready = initializeState();
