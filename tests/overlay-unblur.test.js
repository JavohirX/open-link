const test = require('node:test');
const assert = require('node:assert/strict');

test('Overlay detection & removal targets blurred_overlay__title container', () => {
  // Simulating user-provided DOM structure
  const userHtml = `
    <div class="absolute top-1/2 left-0 right-0 m-auto -translate-y-1/2 container-raised container-lined font-sans text-color-text text-center max-w-[600px] w-3/4 pb-3">
      <h2 class="blurred_overlay__title font-bold text-lg m-2 mt-3">View Javohir’s full experience</h2>
      <button class="sign-in-modal__outlet-btn blurred-overlay__sign-in-cta">Sign in</button>
      <div id="blurred-overlay-sign-in-modal" class="modal modal--sign-in"></div>
    </div>
  `;

  // Verify class matching
  assert.match(userHtml, /blurred_overlay__title/);
  assert.match(userHtml, /container-raised/);
  assert.match(userHtml, /blurred-overlay__sign-in-cta/);
  assert.match(userHtml, /blurred-overlay-sign-in-modal/);
});

test('Schema.org unmasking extracts institution and job title correctly', () => {
  const sampleJsonLd = {
    '@context': 'http://schema.org',
    '@type': 'Person',
    name: 'Javohir',
    jobTitle: ['Software Engineer'],
    worksFor: [
      {
        '@type': 'Organization',
        name: 'AVLOAI'
      }
    ],
    alumniOf: [
      {
        '@type': 'EducationalOrganization',
        name: 'Inha University in Tashkent'
      }
    ]
  };

  const alumni = sampleJsonLd.alumniOf;
  const jobs = sampleJsonLd.worksFor;
  const title = sampleJsonLd.jobTitle[0];

  assert.equal(alumni[0].name, 'Inha University in Tashkent');
  assert.equal(jobs[0].name, 'AVLOAI');
  assert.equal(title, 'Software Engineer');

  // Verify unmasking of **** ********** ** ********
  const maskedHeading = '**** ********** ** ********';
  const isMasked = /^\*+[\s\*]*$/.test(maskedHeading);
  assert.equal(isMasked, true);

  // Resolution simulation
  const resolvedHeading = isMasked ? alumni[0].name : maskedHeading;
  assert.equal(resolvedHeading, 'Inha University in Tashkent');
});

test('Positional index fallback unmasks entities when logo slug matching is unavailable', () => {
  const jobs = [
    { '@type': 'Organization', name: 'Google' },
    { '@type': 'Organization', name: 'DeepMind' }
  ];
  const titles = ['Senior Engineer', 'Staff Researcher'];

  const maskedHeadings = ['******', '********'];
  const maskedSubHeadings = ['***************', '****************'];

  const unmaskedHeadings = maskedHeadings.map((h, i) => jobs[i]?.name || h);
  const unmaskedSubHeadings = maskedSubHeadings.map((s, i) => titles[i] || s);

  assert.equal(unmaskedHeadings[0], 'Google');
  assert.equal(unmaskedHeadings[1], 'DeepMind');
  assert.equal(unmaskedSubHeadings[0], 'Senior Engineer');
  assert.equal(unmaskedSubHeadings[1], 'Staff Researcher');
});

