const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAuthwallUrl,
  safeUrlDecode,
  extractSessionRedirect,
  isRestorableTarget,
  inspectAuthwallNavigation,
  isRegionalLinkedInUrl,
  getCanonicalLinkedInUrl,
  normalizeProfileUrl,
  extractProfileSlug
} = require('../lib/url-parser.js');

test('isAuthwallUrl identifies LinkedIn authwall domains correctly', () => {
  assert.equal(isAuthwallUrl('https://www.linkedin.com/authwall?trk=gf'), true);
  assert.equal(isAuthwallUrl('https://kr.linkedin.com/authwall?sessionRedirect=test'), true);
  assert.equal(isAuthwallUrl('https://uk.linkedin.com/authwall'), true);
  assert.equal(isAuthwallUrl('https://de.linkedin.com/authwall/'), true);
  assert.equal(isAuthwallUrl('https://linkedin.com/authwall'), true);
  assert.equal(isAuthwallUrl('https://www.linkedin.cn/authwall'), true);

  assert.equal(isAuthwallUrl('https://www.linkedin.com/in/williamhgates'), false);
  assert.equal(isAuthwallUrl('https://kr.linkedin.com/in/kholmatov-s'), false);
  assert.equal(isAuthwallUrl('https://www.linkedin.com/login'), false);
  assert.equal(isAuthwallUrl('https://www.linkedin.com/feed'), false);
  assert.equal(isAuthwallUrl('https://evil-linkedin.com/authwall'), false);
  assert.equal(isAuthwallUrl('https://google.com/authwall'), false);
  assert.equal(isAuthwallUrl('invalid-url'), false);
});

test('safeUrlDecode handles single, double, and non-encoded strings', () => {
  assert.equal(safeUrlDecode('https://kr.linkedin.com/in/kholmatov-s'), 'https://kr.linkedin.com/in/kholmatov-s');
  assert.equal(
    safeUrlDecode('https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s'),
    'https://kr.linkedin.com/in/kholmatov-s'
  );
  assert.equal(
    safeUrlDecode('https%253A%252F%252Fkr.linkedin.com%252Fin%252Fkholmatov-s'),
    'https://kr.linkedin.com/in/kholmatov-s'
  );
});

test('extractSessionRedirect extracts and preserves original country domain (FR-2, FR-6)', () => {
  const sampleAuthwallUrl =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';

  const extracted = extractSessionRedirect(sampleAuthwallUrl);
  assert.equal(extracted, 'https://kr.linkedin.com/in/kholmatov-s');
});

test('extractSessionRedirect handles alternate subdomains and relative paths', () => {
  const ukUrl = 'https://uk.linkedin.com/authwall?sessionRedirect=https%3A%2F%2Fuk.linkedin.com%2Fin%2Fjohn-smith';
  assert.equal(extractSessionRedirect(ukUrl), 'https://uk.linkedin.com/in/john-smith');

  const relUrl = 'https://de.linkedin.com/authwall?sessionRedirect=%2Fin%2Fmax-mustermann';
  assert.equal(extractSessionRedirect(relUrl), 'https://de.linkedin.com/in/max-mustermann');

  const altParamUrl = 'https://www.linkedin.com/authwall?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fsatyanadella';
  assert.equal(extractSessionRedirect(altParamUrl), 'https://www.linkedin.com/in/satyanadella');
});

test('extractSessionRedirect rejects malicious and non-LinkedIn targets (Security)', () => {
  assert.equal(
    extractSessionRedirect('https://www.linkedin.com/authwall?sessionRedirect=https%3A%2F%2Fattacker.com%2Fevil'),
    null
  );
  assert.equal(
    extractSessionRedirect('https://www.linkedin.com/authwall?sessionRedirect=javascript%3Aalert(1)'),
    null
  );
  assert.equal(
    extractSessionRedirect('https://www.linkedin.com/authwall?sessionRedirect=data%3Atext%2Fhtml%2Cevil'),
    null
  );
  assert.equal(
    extractSessionRedirect('https://www.linkedin.com/authwall?trk=gf'),
    null
  );
});

test('isRestorableTarget scopes strictly to profiles and content, disallowing auth endpoints (FR-7)', () => {
  assert.equal(isRestorableTarget('https://kr.linkedin.com/in/kholmatov-s'), true);
  assert.equal(isRestorableTarget('https://www.linkedin.com/in/williamhgates'), true);
  assert.equal(isRestorableTarget('https://www.linkedin.com/company/google'), true);
  assert.equal(isRestorableTarget('https://www.linkedin.com/posts/example'), true);

  assert.equal(isRestorableTarget('https://www.linkedin.com/login'), false);
  assert.equal(isRestorableTarget('https://www.linkedin.com/uas/login'), false);
  assert.equal(isRestorableTarget('https://www.linkedin.com/checkpoint/challenge'), false);
  assert.equal(isRestorableTarget('https://www.linkedin.com/signup'), false);
  assert.equal(isRestorableTarget('https://www.linkedin.com/feed'), false);
  assert.equal(isRestorableTarget('https://external.com/in/test'), false);
});

test('inspectAuthwallNavigation coordinates the entire pipeline', () => {
  const input =
    'https://www.linkedin.com/authwall?trk=gf&original_referer=https://duckduckgo.com/&sessionRedirect=https%3A%2F%2Fkr.linkedin.com%2Fin%2Fkholmatov-s';

  const result = inspectAuthwallNavigation(input);
  assert.deepEqual(result, {
    isAuthwall: true,
    targetUrl: 'https://kr.linkedin.com/in/kholmatov-s',
    shouldRestore: true
  });
});

test('isRegionalLinkedInUrl detects country subdomains while ignoring www and apex', () => {
  assert.equal(isRegionalLinkedInUrl('https://kr.linkedin.com/in/kholmatov-s'), true);
  assert.equal(isRegionalLinkedInUrl('https://uk.linkedin.com/in/john-smith'), true);
  assert.equal(isRegionalLinkedInUrl('https://de.linkedin.com/company/sap'), true);
  assert.equal(isRegionalLinkedInUrl('https://fr.linkedin.cn/in/test'), true);

  assert.equal(isRegionalLinkedInUrl('https://www.linkedin.com/in/kholmatov-s'), false);
  assert.equal(isRegionalLinkedInUrl('https://linkedin.com/in/kholmatov-s'), false);
  assert.equal(isRegionalLinkedInUrl('https://static.licdn.com/test'), false);
  assert.equal(isRegionalLinkedInUrl('https://google.com'), false);
});

test('getCanonicalLinkedInUrl converts country subdomain URLs to www.linkedin.com', () => {
  assert.equal(
    getCanonicalLinkedInUrl('https://kr.linkedin.com/in/kholmatov-s'),
    'https://www.linkedin.com/in/kholmatov-s'
  );
  assert.equal(
    getCanonicalLinkedInUrl('https://uk.linkedin.com/in/john-smith?trk=public_profile'),
    'https://www.linkedin.com/in/john-smith?trk=public_profile'
  );
  assert.equal(
    getCanonicalLinkedInUrl('https://de.linkedin.cn/company/sap'),
    'https://www.linkedin.cn/company/sap'
  );

  // Already canonical or apex returns null
  assert.equal(getCanonicalLinkedInUrl('https://www.linkedin.com/in/kholmatov-s'), null);
  assert.equal(getCanonicalLinkedInUrl('https://linkedin.com/in/kholmatov-s'), null);
  assert.equal(getCanonicalLinkedInUrl('https://attacker.com/in/kholmatov-s'), null);
});

test('normalizeProfileUrl removes tracking parameters and trailing slashes', () => {
  const urlWithParams =
    'https://www.linkedin.com/in/kholmatov-s/?trk=public_profile&original_referer=https%3A%2F%2Fgoogle.com&trkCode=bf';
  assert.equal(
    normalizeProfileUrl(urlWithParams),
    'https://www.linkedin.com/in/kholmatov-s'
  );

  const cleanUrl = 'https://kr.linkedin.com/in/john-smith';
  assert.equal(normalizeProfileUrl(cleanUrl), 'https://kr.linkedin.com/in/john-smith');
});

test('extractProfileSlug extracts handle from various LinkedIn profile URLs', () => {
  assert.equal(extractProfileSlug('https://uz.linkedin.com/in/javohirx'), 'javohirx');
  assert.equal(extractProfileSlug('https://www.linkedin.com/in/kholmatov-s/'), 'kholmatov-s');
  assert.equal(extractProfileSlug('https://kr.linkedin.com/in/satyanadella?trk=test'), 'satyanadella');
  assert.equal(extractProfileSlug('https://www.linkedin.com/company/microsoft'), '');
  assert.equal(extractProfileSlug('invalid-url'), '');
});


