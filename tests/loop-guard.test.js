const test = require('node:test');
const assert = require('node:assert/strict');
const { LoopGuard } = require('../lib/loop-guard.js');

test('LoopGuard allows initial restoration attempt (Case A / First attempt)', () => {
  const guard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 101;
  const targetUrl = 'https://kr.linkedin.com/in/kholmatov-s';
  const t0 = 10000;

  const check1 = guard.canRestore(tabId, targetUrl, t0);
  assert.equal(check1.allowed, true);
  assert.equal(check1.reason, 'first_attempt');
  assert.equal(check1.attemptCount, 0);

  guard.recordAttempt(tabId, targetUrl, t0);
  assert.equal(guard.getTabStatus(tabId).attemptCount, 1);
  assert.equal(guard.getTabStatus(tabId).status, 'restoring');
});

test('LoopGuard prevents infinite cycle when same target redirects back rapidly (Case B / Loop prevention)', () => {
  const guard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 101;
  const targetUrl = 'https://kr.linkedin.com/in/kholmatov-s';
  const t0 = 10000;

  assert.equal(guard.canRestore(tabId, targetUrl, t0).allowed, true);
  guard.recordAttempt(tabId, targetUrl, t0);

  const t1 = t0 + 400;
  const check2 = guard.canRestore(tabId, targetUrl, t1);
  assert.equal(check2.allowed, false);
  assert.equal(check2.reason, 'loop_detected');
  assert.equal(check2.attemptCount, 1);

  guard.markLoopPrevented(tabId, targetUrl, t1);
  assert.equal(guard.getTabStatus(tabId).status, 'loop_prevented');
});

test('LoopGuard allows restoration when user navigates to a DIFFERENT target profile', () => {
  const guard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 101;
  const targetUrl1 = 'https://kr.linkedin.com/in/kholmatov-s';
  const targetUrl2 = 'https://www.linkedin.com/in/williamhgates';
  const t0 = 10000;

  guard.recordAttempt(tabId, targetUrl1, t0);

  const t1 = t0 + 300;
  const check = guard.canRestore(tabId, targetUrl2, t1);
  assert.equal(check.allowed, true);
  assert.equal(check.reason, 'target_changed');
});

test('LoopGuard allows restoration after the sliding window expires', () => {
  const guard = new LoopGuard({ windowMs: 5000, maxAttempts: 1 });
  const tabId = 101;
  const targetUrl = 'https://kr.linkedin.com/in/kholmatov-s';
  const t0 = 10000;

  guard.recordAttempt(tabId, targetUrl, t0);

  const t1 = t0 + 6000;
  const check = guard.canRestore(tabId, targetUrl, t1);
  assert.equal(check.allowed, true);
  assert.equal(check.reason, 'window_expired');
});

test('LoopGuard tracks tabs independently and cleans up on tab removal', () => {
  const guard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tab1 = 101;
  const tab2 = 102;
  const url = 'https://kr.linkedin.com/in/kholmatov-s';
  const t0 = 10000;

  guard.recordAttempt(tab1, url, t0);
  assert.equal(guard.canRestore(tab1, url, t0 + 200).allowed, false);

  assert.equal(guard.canRestore(tab2, url, t0 + 200).allowed, true);

  guard.removeTab(tab1);
  assert.equal(guard.getTabStatus(tab1), null);
});

test('LoopGuard serialization and deserialization across service worker restarts', () => {
  const guard1 = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 202;
  const url = 'https://kr.linkedin.com/in/kholmatov-s';
  const t0 = 20000;

  guard1.recordAttempt(tabId, url, t0);
  const serialized = guard1.toJSON();

  const guard2 = new LoopGuard();
  guard2.fromJSON(serialized, t0 + 500);

  assert.equal(guard2.canRestore(tabId, url, t0 + 600).allowed, false);
  assert.equal(guard2.getTabStatus(tabId).attemptCount, 1);
});

test('LoopGuard tracks and persists triedCanonical across tab operations and restarts', () => {
  const guard = new LoopGuard({ windowMs: 8000, maxAttempts: 1 });
  const tabId = 303;
  const originalUrl = 'https://kr.linkedin.com/in/kholmatov-s';
  const canonicalUrl = 'https://www.linkedin.com/in/kholmatov-s';
  const t0 = 10000;

  guard.recordAttempt(tabId, originalUrl, t0);
  assert.equal(guard.hasTriedCanonical(tabId), false);

  guard.markCanonicalTried(tabId);
  assert.equal(guard.hasTriedCanonical(tabId), true);

  // Serialized state preserves triedCanonical
  const saved = guard.toJSON();
  const restoredGuard = new LoopGuard();
  restoredGuard.fromJSON(saved, t0 + 100);

  assert.equal(restoredGuard.hasTriedCanonical(tabId), true);
});

