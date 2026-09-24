/**
 * LinkedIn Authwall Guard - Profile Page Enhancer (Case A & Unblurrer)
 *
 * Runs at document_start on *.linkedin.com/in/*
 * Functions:
 * 1. Back button handling: If the browser navigates back to a redirect stub page,
 *    immediately continues back so the user seamlessly returns to Google search.
 * 2. Delete the Experience & Education overlay box (e.g. "View Javohir's full experience").
 * 3. Make Experience & Education completely clear (unblur .blur and .blurred-content).
 * 4. Restore masked asterisks (****) from schema.org JSON-LD if present.
 * 5. Case A Enhancer: Dismisses contextual sign-in popups and unlocks scrolling.
 */

(function () {
  // -------------------------------------------------------------
  // 1. Back Button Navigation Handler
  // -------------------------------------------------------------
  function checkBackNavigation() {
    try {
      const navEntries = performance.getEntriesByType('navigation');
      const isBackForward = navEntries.length > 0 && navEntries[0].type === 'back_forward';
      if (isBackForward) {
        const hasProfileMeta = document.querySelector('meta[name="pageKey"]') ||
                              document.querySelector('link[rel="canonical"]');
        if (!hasProfileMeta) {
          console.log('[AuthwallGuard] Back navigation reached intermediate stub. Skipping back to search...');
          window.history.back();
          return true;
        }
      }
    } catch {}
    return false;
  }

  function checkForwardStubNavigation() {
    try {
      const hasProfileMeta = document.querySelector('meta[name="pageKey"]') ||
                            document.querySelector('link[rel="canonical"]') ||
                            document.querySelector('main, #profile-content, .scaffold-layout');
      if (!hasProfileMeta && (!document.body || !document.body.textContent.trim())) {
        const scripts = Array.from(document.querySelectorAll('script'));
        const hasAuthwallStub = scripts.some(s => s.textContent && s.textContent.includes('/authwall'));
        if (hasAuthwallStub) {
          console.log('[AuthwallGuard] 999 stub page detected. Fast-forwarding to authwall...');
          const currentHost = window.location.host;
          const targetDomain = (currentHost !== 'www.linkedin.com' && currentHost !== 'www.linkedin.cn')
            ? 'www.linkedin.com'
            : currentHost;
          const redirectUrl = `https://${targetDomain}/authwall?sessionRedirect=${encodeURIComponent(window.location.href)}`;
          window.location.replace(redirectUrl);
          return true;
        }
      }
    } catch {}
    return false;
  }

  if (checkBackNavigation() || checkForwardStubNavigation()) {
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (checkBackNavigation() || checkForwardStubNavigation()) return;
    }, { once: true });
  }

  // -------------------------------------------------------------
  // 2. Settings & Initialization
  // -------------------------------------------------------------
  let settings = { autoDismissModals: true, enabled: true };

  try {
    chrome.storage.local.get('settings', (res) => {
      if (res && res.settings) {
        settings = { ...settings, ...res.settings };
      }
      if (settings.enabled) {
        initEnhancer();
      }
    });
  } catch {
    initEnhancer();
  }

  function unlockScroll() {
    document.documentElement.classList.add('li-guard-scroll-unlocked');
    document.body?.classList.add('li-guard-scroll-unlocked');
    if (document.body && document.body.style.overflow === 'hidden') {
      document.body.style.overflow = '';
    }
  }

  // -------------------------------------------------------------
  // 3. Delete Experience & Education Overlay Box
  // -------------------------------------------------------------
  function removeExperienceOverlay() {
    // Target headers like "View Javohir’s full experience"
    const titles = document.querySelectorAll('.blurred_overlay__title');
    titles.forEach((h2) => {
      const container = h2.closest('.container-raised') ||
                        h2.closest('div[class*="container-raised"]') ||
                        h2.parentElement;
      if (container && container.parentNode) {
        container.remove();
      }
    });

    // Target the blurred-overlay sign-in CTA button containers
    const ctaButtons = document.querySelectorAll(
      '.blurred-overlay__sign-in-cta, [data-modal="blurred-overlay-sign-in-modal"]'
    );
    ctaButtons.forEach((btn) => {
      const box = btn.closest('.container-raised') || btn.closest('div[class*="container-raised"]');
      if (box && box.parentNode) {
        box.remove();
      }
    });

    // Remove any blurred overlay modal markup
    const modals = document.querySelectorAll(
      '#blurred-overlay-sign-in-modal, [data-outlet="blurred-overlay-sign-in-modal"]'
    );
    modals.forEach((m) => m.remove());

    // Contextual sign-in modals
    const contextualModals = document.querySelectorAll(
      '.modal--contextual-sign-in, .contextual-sign-in-modal, .modal__overlay, [data-impression-id*="contextual-sign-in"]'
    );
    contextualModals.forEach((el) => {
      if (!el.classList.contains('li-guard-hidden-modal')) {
        el.classList.add('li-guard-hidden-modal');
      }
    });
  }

  // -------------------------------------------------------------
  // 4. Unblur Experience & Education Section
  // -------------------------------------------------------------
  function unblurExperienceSection() {
    // Target any blurred containers or text
    const blurred = document.querySelectorAll(
      '.blur, .blurred-content, .blurred-overlay, [class*="blurred-content"]'
    );
    blurred.forEach((el) => {
      el.classList.remove('blur');
      el.classList.remove('blurred-content');
      el.removeAttribute('aria-hidden');
      el.removeAttribute('tabindex');
      el.style.filter = 'none';
      el.style.webkitFilter = 'none';
      el.style.opacity = '1';
      el.style.userSelect = 'auto';
      el.style.pointerEvents = 'auto';
      el.style.visibility = 'visible';
    });

    // Clean up lists inside experience & education
    const lists = document.querySelectorAll('.blurred-list, .visible-list');
    lists.forEach((list) => {
      list.removeAttribute('aria-hidden');
    });

    // Unmask asterisks using Schema.org JSON-LD if present
    restoreFromSchemaJsonLd();
  }

  // -------------------------------------------------------------
  // 5. Restore Masked Asterisk Content from JSON-LD
  // -------------------------------------------------------------
  function restoreFromSchemaJsonLd() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      let person = null;

      for (const s of scripts) {
        try {
          const parsed = JSON.parse(s.textContent);
          if (parsed && parsed['@type'] === 'Person') {
            person = parsed;
            break;
          }
          if (Array.isArray(parsed)) {
            const found = parsed.find(item => item && item['@type'] === 'Person');
            if (found) { person = found; break; }
          }
          if (parsed && Array.isArray(parsed['@graph'])) {
            const found = parsed['@graph'].find(item => item && item['@type'] === 'Person');
            if (found) { person = found; break; }
          }
        } catch {}
      }

      if (!person) return;

      const alumni = Array.isArray(person.alumniOf)
        ? person.alumniOf
        : (person.alumniOf ? [person.alumniOf] : []);
      const jobs = Array.isArray(person.worksFor)
        ? person.worksFor
        : (person.worksFor ? [person.worksFor] : []);
      const titles = Array.isArray(person.jobTitle)
        ? person.jobTitle
        : (person.jobTitle ? [person.jobTitle] : []);

      const items = document.querySelectorAll(
        '.experience-education__list li, .experience-education li, .blurred-list li, .visible-list li'
      );

      items.forEach((li, index) => {
        const heading = li.querySelector('h3');
        const subHeading = li.querySelector('h4');
        const imgDiv = li.querySelector('div[role="img"], img');
        const bgStyle = (imgDiv && (imgDiv.style.backgroundImage || imgDiv.src || '')) || '';

        // Unmask heading if it consists of asterisks (e.g. "**** ********** ** ********")
        if (heading && /^\*+[\s\*]*$/.test(heading.textContent.trim())) {
          // Check education by logo URL or single item
          for (const edu of alumni) {
            if (edu && edu.name) {
              const cleanSlug = edu.name.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (bgStyle.toLowerCase().includes(cleanSlug) || alumni.length === 1) {
                heading.textContent = edu.name;
                break;
              }
            }
          }

          // Check work experience if still asterisks
          if (/^\*+[\s\*]*$/.test(heading.textContent.trim())) {
            for (const job of jobs) {
              if (job && job.name) {
                const cleanSlug = job.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (bgStyle.toLowerCase().includes(cleanSlug) || jobs.length === 1) {
                  heading.textContent = job.name;
                  break;
                }
              }
            }
          }

          // Positional index fallback: if logo matching failed, use order of appearance
          if (/^\*+[\s\*]*$/.test(heading.textContent.trim())) {
            const allEntities = [...jobs, ...alumni];
            if (allEntities[index] && allEntities[index].name) {
              heading.textContent = allEntities[index].name;
            }
          }
        }

        // Unmask subHeading if it consists of asterisks (e.g. "******** ********")
        if (subHeading) {
          const text = subHeading.textContent.trim();
          if (/^\*+[\s\*]*$/.test(text)) {
            if (titles[index]) {
              subHeading.textContent = titles[index];
            } else if (titles.length > 0) {
              subHeading.textContent = titles.join(', ');
            }
          }
        }
      });
    } catch (err) {
      console.debug('[AuthwallGuard] Schema unmasking error:', err);
    }
  }

  // -------------------------------------------------------------
  // 6. Execution & Mutation Observer
  // -------------------------------------------------------------
  function performCleanup() {
    removeExperienceOverlay();
    unblurExperienceSection();
    unlockScroll();
  }

  function initEnhancer() {
    performCleanup();

    // Observe DOM mutations to catch elements rendered asynchronously
    const observer = new MutationObserver((mutations) => {
      let shouldRun = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          shouldRun = true;
          break;
        }
      }
      if (shouldRun) {
        performCleanup();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', performCleanup, { once: true });
    }

    window.addEventListener('load', () => {
      performCleanup();
      setTimeout(performCleanup, 500);
      setTimeout(performCleanup, 1500);
      setTimeout(performCleanup, 3000);
    });
  }
})();
