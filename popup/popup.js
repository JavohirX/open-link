/**
 * LinkedIn Authwall Guard - Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const toggleEnabled = document.getElementById('toggle-enabled');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const statRestored = document.getElementById('stat-restored');
  const statLoops = document.getElementById('stat-loops');
  const tabBadge = document.getElementById('tab-badge');
  const tabInfo = document.getElementById('tab-info');
  const activityList = document.getElementById('activity-list');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  const settingMaxAttempts = document.getElementById('setting-max-attempts');
  const settingWindowSec = document.getElementById('setting-window-sec');
  const settingDismissModals = document.getElementById('setting-dismiss-modals');

  // Load Initial Data
  async function loadData() {
    try {
      const data = await chrome.storage.local.get(['settings', 'stats', 'recentEvents']);
      const settings = data.settings || {
        enabled: true,
        windowMs: 8000,
        maxAttempts: 1,
        autoDismissModals: true
      };
      const stats = data.stats || { restored: 0, loopsPrevented: 0 };
      const recentEvents = data.recentEvents || [];

      // Update Controls
      toggleEnabled.checked = settings.enabled !== false;
      settingMaxAttempts.value = String(settings.maxAttempts || 1);
      settingWindowSec.value = String(Math.round((settings.windowMs || 8000) / 1000));
      settingDismissModals.checked = settings.autoDismissModals !== false;

      updateStatusUI(toggleEnabled.checked);

      // Update Metrics
      statRestored.textContent = String(stats.restored || 0);
      statLoops.textContent = String(stats.loopsPrevented || 0);

      // Render Logs
      renderActivity(recentEvents);

      // Inspect Active Tab
      await inspectCurrentTab();
    } catch (err) {
      console.error('Failed to load popup data:', err);
    }
  }

  function updateStatusUI(isEnabled) {
    if (isEnabled) {
      statusBar.className = 'status-bar status-active';
      statusText.textContent = 'Active & Guarding';
    } else {
      statusBar.className = 'status-bar status-disabled';
      statusText.textContent = 'Extension Disabled';
    }
  }

  async function inspectCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        tabBadge.className = 'badge badge-neutral';
        tabBadge.textContent = 'Idle';
        tabInfo.textContent = 'No active page found.';
        return;
      }

      const url = new URL(tab.url);
      const isLinkedIn = /(^|\.)linkedin\.(com|cn)$/i.test(url.hostname);

      if (!isLinkedIn) {
        tabBadge.className = 'badge badge-neutral';
        tabBadge.textContent = 'External';
        tabInfo.textContent = `Current domain: ${url.hostname}`;
        return;
      }

      // Check with background diagnostics
      chrome.runtime.sendMessage({ type: 'GET_DIAGNOSTICS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          showTabDefault(tab.url, isLinkedIn);
          return;
        }

        const tabRecord = res.activeTabRecords?.records?.[tab.id];
        if (tabRecord) {
          if (tabRecord.status === 'loop_prevented') {
            tabBadge.className = 'badge badge-warning';
            tabBadge.textContent = 'Loop Guard';
            tabInfo.innerHTML = `Authwall loop prevented for: <br><strong>${escapeHtml(tabRecord.targetUrl)}</strong>`;
          } else if (tabRecord.status === 'restoring') {
            tabBadge.className = 'badge badge-success';
            tabBadge.textContent = 'Restored';
            tabInfo.innerHTML = `Restored navigation to: <br><strong>${escapeHtml(tabRecord.targetUrl)}</strong>`;
          } else {
            showTabDefault(tab.url, isLinkedIn);
          }
        } else {
          showTabDefault(tab.url, isLinkedIn);
        }
      });
    } catch {
      tabBadge.textContent = 'Idle';
      tabInfo.textContent = 'Unable to inspect current tab.';
    }
  }

  function showTabDefault(tabUrl, isLinkedIn) {
    if (tabUrl.includes('/authwall')) {
      tabBadge.className = 'badge badge-warning';
      tabBadge.textContent = 'Authwall';
      tabInfo.textContent = 'Currently on LinkedIn Authwall.';
    } else if (tabUrl.includes('/in/')) {
      tabBadge.className = 'badge badge-success';
      tabBadge.textContent = 'Profile';
      tabInfo.textContent = 'Viewing LinkedIn profile.';
    } else {
      tabBadge.className = 'badge badge-neutral';
      tabBadge.textContent = 'LinkedIn';
      tabInfo.textContent = 'Active on LinkedIn.';
    }
  }

  function renderActivity(events) {
    if (!events || events.length === 0) {
      activityList.innerHTML = '<div class="empty-state">No interceptions recorded yet.</div>';
      return;
    }

    activityList.innerHTML = events
      .slice(0, 15)
      .map((ev) => {
        const timeStr = new Date(ev.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        const isRestored = ev.result === 'restored';
        const isFallback = ev.result === 'canonical_fallback';
        let badgeClass = 'badge-warning';
        let label = 'Loop Prevented';
        if (isRestored) {
          badgeClass = 'badge-success';
          label = 'Restored';
        } else if (isFallback) {
          badgeClass = 'badge-neutral';
          label = 'Fallback (www)';
        }

        return `
          <div class="activity-item">
            <div class="activity-top">
              <span>${timeStr}</span>
              <span class="badge ${badgeClass}">${label}</span>
            </div>
            <div class="activity-url" title="${escapeHtml(ev.targetUrl || ev.authwallUrl)}">
              ${escapeHtml(ev.targetUrl || ev.authwallUrl)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  async function saveSettings() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const updated = {
      ...settings,
      enabled: toggleEnabled.checked,
      maxAttempts: parseInt(settingMaxAttempts.value, 10),
      windowMs: parseInt(settingWindowSec.value, 10) * 1000,
      autoDismissModals: settingDismissModals.checked
    };
    await chrome.storage.local.set({ settings: updated });
    updateStatusUI(updated.enabled);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Event Listeners
  toggleEnabled.addEventListener('change', saveSettings);
  settingMaxAttempts.addEventListener('change', saveSettings);
  settingWindowSec.addEventListener('change', saveSettings);
  settingDismissModals.addEventListener('change', saveSettings);

  btnClearLogs.addEventListener('click', async () => {
    await chrome.storage.local.set({ recentEvents: [] });
    renderActivity([]);
  });

  // Initial render
  await loadData();
});
