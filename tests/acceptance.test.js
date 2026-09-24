const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  inspectAuthwallNavigation,
  extractSessionRedirect,
  isRestorableTarget
} = require('../lib/url-parser.js');
const { LoopGuard } = require('../lib/loop-guard.js');

test('Acceptance Test 1-4: Authwall detection, sessionRedirect recovery, country domain preservation, and return to original profile', () => {
  const authwallInput =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';

  const inspection = inspectAuthwallNavigation(authwallInput);
  assert.equal(inspection.isAuthwall, true);
  assert.equal(inspection.shouldRestore, true);

  const recoveredUrl = inspection.targetUrl;
  assert.equal(recoveredUrl, 'https://kr.linkedin.com/in/kholmatov-s');
  assert.match(recoveredUrl, /^https:\/\/kr\.linkedin\.com\//);

  const loopGuard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 1;
  const t0 = 10000;

  const decision = loopGuard.canRestore(tabId, recoveredUrl, t0);
  assert.equal(decision.allowed, true);
  assert.equal(decision.attemptCount, 0);

  loopGuard.recordAttempt(tabId, recoveredUrl, t0);
  assert.equal(loopGuard.getTabStatus(tabId).status, 'restoring');
});

test('Acceptance Test 5: Infinite redirect loop prevention (FR-5 / Case B Server-side authwall)', () => {
  const authwallInput =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';
  const targetUrl = extractSessionRedirect(authwallInput);

  const loopGuard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 42;
  const t0 = 1000;

  assert.equal(loopGuard.canRestore(tabId, targetUrl, t0).allowed, true);
  loopGuard.recordAttempt(tabId, targetUrl, t0);

  const t1 = t0 + 250;
  const secondCheck = loopGuard.canRestore(tabId, targetUrl, t1);

  assert.equal(secondCheck.allowed, false);
  assert.equal(secondCheck.reason, 'loop_detected');

  loopGuard.markLoopPrevented(tabId, targetUrl, t1);
  assert.equal(loopGuard.getTabStatus(tabId).status, 'loop_prevented');

  assert.equal(loopGuard.canRestore(tabId, targetUrl, t1 + 100).allowed, false);
});

test('Acceptance Test 6: Zero external data transmission / privacy verification', () => {
  const filesToAudit = [
    'background.js',
    'lib/url-parser.js',
    'lib/loop-guard.js',
    'content/authwall.js',
    'content/profile.js',
    'popup/popup.js'
  ];

  const forbiddenPatterns = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bnavigator\.sendBeacon\b/,
    /\bWebSocket\b/
  ];

  for (const file of filesToAudit) {
    const fullPath = path.join(__dirname, '..', file);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `Privacy check failed: ${file} must not contain external network calls matching ${pattern}`
      );
    }
  }
});

test('Acceptance Test 7: Normal LinkedIn login and auth pages are unaffected (FR-7)', () => {
  const loginUrls = [
    'https://www.linkedin.com/login',
    'https://www.linkedin.com/uas/login',
    'https://www.linkedin.com/checkpoint/lg/login-submit',
    'https://www.linkedin.com/signup',
    'https://kr.linkedin.com/login'
  ];

  for (const loginUrl of loginUrls) {
    assert.equal(inspectAuthwallNavigation(loginUrl).isAuthwall, false);
    assert.equal(isRestorableTarget(loginUrl), false);
  }

  const authwallWithLogin =
    'https://www.linkedin.com/authwall?sessionRedirect=https%3A%2F%2Fwww.linkedin.com%2Flogin';
  const res = inspectAuthwallNavigation(authwallWithLogin);
  assert.equal(res.isAuthwall, true);
  assert.equal(res.shouldRestore, false);
});

test('Acceptance Test 8: Case B Subdomain Fallback and canonical recovery flow', () => {
  const { isRegionalLinkedInUrl, getCanonicalLinkedInUrl } = require('../lib/url-parser.js');

  const regionalAuthwall =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';
  const targetUrl = extractSessionRedirect(regionalAuthwall);
  assert.equal(targetUrl, 'https://kr.linkedin.com/in/kholmatov-s');
  assert.equal(isRegionalLinkedInUrl(targetUrl), true);

  const canonical = getCanonicalLinkedInUrl(targetUrl);
  assert.equal(canonical, 'https://www.linkedin.com/in/kholmatov-s');
  assert.equal(isRestorableTarget(canonical), true);

  const loopGuard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 99;
  const t0 = 1000;

  // First attempt on regional URL is allowed
  assert.equal(loopGuard.canRestore(tabId, targetUrl, t0).allowed, true);
  loopGuard.recordAttempt(tabId, targetUrl, t0);

  // Bounce 1: regional loop detected
  const t1 = t0 + 200;
  assert.equal(loopGuard.canRestore(tabId, targetUrl, t1).allowed, false);

  // Fallback to canonical is attempted
  assert.equal(loopGuard.hasTriedCanonical(tabId), false);
  loopGuard.markCanonicalTried(tabId);
  assert.equal(loopGuard.hasTriedCanonical(tabId), true);
  loopGuard.recordAttempt(tabId, canonical, t1);

  // Bounce 2: canonical loop detected
  const t2 = t1 + 200;
  assert.equal(loopGuard.canRestore(tabId, canonical, t2).allowed, false);
  loopGuard.markLoopPrevented(tabId, canonical, t2);

  assert.equal(loopGuard.getTabStatus(tabId).status, 'loop_prevented');
});

