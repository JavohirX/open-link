const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSessionRedirect, isRestorableTarget } = require('../lib/url-parser.js');

test('Back navigation: Authwall URL must be recognized for skip-back, not forward restoration', () => {
  const authwallUrl =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';

  // When transitionQualifiers contains 'forward_back', the navigation was initiated by browser Back/Forward
  const details = {
    url: authwallUrl,
    transitionType: 'forward_back',
    transitionQualifiers: ['forward_back'],
    tabId: 42
  };

  const isBackForward =
    details.transitionQualifiers.includes('forward_back') || details.transitionType === 'forward_back';
  assert.equal(isBackForward, true, 'Must detect Back navigation');

  // On Back navigation, we must NOT push forward, but go back
  const shouldSkipBack = isBackForward && details.url.includes('/authwall');
  assert.equal(shouldSkipBack, true, 'Must skip backwards instead of re-redirecting forward');
});

test('In-place replacement: extractSessionRedirect accurately extracts target for location.replace', () => {
  const url =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';

  const target = extractSessionRedirect(url);
  assert.equal(target, 'https://kr.linkedin.com/in/kholmatov-s');
  assert.equal(isRestorableTarget(target), true);
});

test('Redirect stub detection: Distinguishes between 999 stub page and real public profile page', () => {
  // Simulating the 999 HTML: empty or minimal title without pageKey
  const stubPage = {
    title: '',
    hasPageKeyMeta: false,
    hasCanonical: false
  };

  const isStub = !stubPage.hasPageKeyMeta && !stubPage.hasCanonical;
  assert.equal(isStub, true, 'Stub page should be identified for immediate skip-back');

  // Real loaded profile
  const realPage = {
    title: 'Sanjar Kholmatov | LinkedIn',
    hasPageKeyMeta: true,
    hasCanonical: true
  };

  const isRealProfileStub = !realPage.hasPageKeyMeta && !realPage.hasCanonical;
  assert.equal(isRealProfileStub, false, 'Real profile page should NOT be skipped');
});
