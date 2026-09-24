/**
 * Per-Tab Redirect Loop Guard (FR-5)
 *
 * Prevents infinite cycles of:
 * profile → authwall → profile → authwall → ...
 *
 * Implements a sliding-window consecutive attempt tracker keyed by tabId.
 * Supports session storage synchronization across MV3 service worker restarts.
 */

class LoopGuard {
  /**
   * @param {Object} options
   * @param {number} [options.windowMs=30000] - Window duration to group consecutive redirects (ms)
   * @param {number} [options.maxAttempts=1] - Max consecutive restorations allowed within the window
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs || 30000;
    this.maxAttempts = options.maxAttempts || 1;
    // Map<tabId, TabRecord>
    this.tabRecords = new Map();
  }

  /**
   * Normalizes URLs for accurate comparison (ignores hash, trailing slashes, and tracking query params)
   *
   * @param {string} url
   * @returns {string}
   */
  normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      const trackingParams = [
        'trk',
        'trkInfo',
        'trkCode',
        'original_referer',
        'originalSubdomain',
        'sessionRedirect',
        'session_redirect',
        'trackingId',
        'midToken'
      ];
      for (const p of trackingParams) {
        u.searchParams.delete(p);
      }
      let norm = u.toString();
      if (norm.endsWith('/') && u.pathname !== '/') {
        norm = norm.slice(0, -1);
      }
      return norm;
    } catch {
      return (url || '').trim();
    }
  }

  /**
   * Checks whether a tab is permitted to restore the target URL
   *
   * @param {number} tabId
   * @param {string} targetUrl
   * @param {number} [now=Date.now()]
   * @returns {{ allowed: boolean, reason: string, attemptCount: number, timeSinceLastAttempt: number|null }}
   */
  canRestore(tabId, targetUrl, now = Date.now()) {
    const normTarget = this.normalizeUrl(targetUrl);
    const record = this.tabRecords.get(tabId);

    if (!record) {
      return {
        allowed: true,
        reason: 'first_attempt',
        attemptCount: 0,
        timeSinceLastAttempt: null
      };
    }

    const isSameTarget = record.targetUrl === normTarget;
    const timeSinceLast = now - record.lastAttemptTime;
    const isWithinWindow = timeSinceLast <= this.windowMs;

    // If target URL changed or window expired, allow and reset
    if (!isSameTarget || !isWithinWindow) {
      return {
        allowed: true,
        reason: !isSameTarget ? 'target_changed' : 'window_expired',
        attemptCount: 0,
        timeSinceLastAttempt: timeSinceLast
      };
    }

    // Same target within window: check if threshold reached
    if (record.attemptCount >= this.maxAttempts) {
      return {
        allowed: false,
        reason: 'loop_detected',
        attemptCount: record.attemptCount,
        timeSinceLastAttempt: timeSinceLast
      };
    }

    return {
      allowed: true,
      reason: 'under_threshold',
      attemptCount: record.attemptCount,
      timeSinceLastAttempt: timeSinceLast
    };
  }

  /**
   * Records a restoration attempt for a tab
   *
   * @param {number} tabId
   * @param {string} targetUrl
   * @param {number} [now=Date.now()]
   * @returns {Object} The updated tab record
   */
  recordAttempt(tabId, targetUrl, now = Date.now()) {
    const normTarget = this.normalizeUrl(targetUrl);
    const existing = this.tabRecords.get(tabId);

    let record;
    if (existing && existing.targetUrl === normTarget && (now - existing.lastAttemptTime) <= this.windowMs) {
      record = {
        targetUrl: normTarget,
        attemptCount: existing.attemptCount + 1,
        firstAttemptTime: existing.firstAttemptTime,
        lastAttemptTime: now,
        status: 'restoring',
        triedCanonical: existing.triedCanonical || false
      };
    } else {
      record = {
        targetUrl: normTarget,
        attemptCount: 1,
        firstAttemptTime: now,
        lastAttemptTime: now,
        status: 'restoring',
        triedCanonical: false
      };
    }

    this.tabRecords.set(tabId, record);
    return record;
  }

  /**
   * Marks that canonical fallback was attempted for this tab
   *
   * @param {number} tabId
   */
  markCanonicalTried(tabId) {
    const existing = this.tabRecords.get(tabId);
    if (existing) {
      existing.triedCanonical = true;
    }
  }

  /**
   * Checks whether canonical fallback was already attempted for this tab
   *
   * @param {number} tabId
   * @returns {boolean}
   */
  hasTriedCanonical(tabId) {
    const existing = this.tabRecords.get(tabId);
    return !!(existing && existing.triedCanonical);
  }

  /**
   * Marks that a loop was prevented for this tab
   *
   * @param {number} tabId
   * @param {string} targetUrl
   * @param {number} [now=Date.now()]
   */
  markLoopPrevented(tabId, targetUrl, now = Date.now()) {
    const normTarget = this.normalizeUrl(targetUrl);
    const existing = this.tabRecords.get(tabId);

    const record = {
      targetUrl: normTarget,
      attemptCount: existing ? existing.attemptCount : 1,
      firstAttemptTime: existing ? existing.firstAttemptTime : now,
      lastAttemptTime: now,
      status: 'loop_prevented',
      triedCanonical: existing ? (existing.triedCanonical || false) : false
    };

    this.tabRecords.set(tabId, record);
    return record;
  }

  /**
   * Cleans up tracking when a tab is closed or navigates away
   *
   * @param {number} tabId
   */
  removeTab(tabId) {
    this.tabRecords.delete(tabId);
  }

  /**
   * Resets tab state (e.g., when a profile navigation successfully loads)
   *
   * @param {number} tabId
   */
  resetTab(tabId) {
    this.tabRecords.delete(tabId);
  }

  /**
   * Returns current status of a tab
   *
   * @param {number} tabId
   * @returns {Object|null}
   */
  getTabStatus(tabId) {
    return this.tabRecords.get(tabId) || null;
  }

  /**
   * Clears all tab records (e.g., on settings change)
   */
  clearAll() {
    this.tabRecords.clear();
  }

  /**
   * Serializes current in-memory state to a plain object for storage persistence
   *
   * @returns {Object}
   */
  toJSON() {
    const data = {};
    for (const [tabId, record] of this.tabRecords.entries()) {
      data[tabId] = record;
    }
    return {
      windowMs: this.windowMs,
      maxAttempts: this.maxAttempts,
      records: data
    };
  }

  /**
   * Reconstructs guard state from serialized data
   *
   * @param {Object} data
   * @param {number} [now=Date.now()]
   */
  fromJSON(data, now = Date.now()) {
    if (!data) return;
    if (data.windowMs) this.windowMs = data.windowMs;
    if (data.maxAttempts) this.maxAttempts = data.maxAttempts;
    this.tabRecords.clear();
    if (data.records && typeof data.records === 'object') {
      for (const [tabIdStr, record] of Object.entries(data.records)) {
        // Prune expired records
        if (record && (now - record.lastAttemptTime) <= this.windowMs) {
          this.tabRecords.set(Number(tabIdStr), record);
        }
      }
    }
  }
}

// Export for ES modules and CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LoopGuard };
} else if (typeof globalThis !== 'undefined') {
  globalThis.LoopGuard = LoopGuard;
}
