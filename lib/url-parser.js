/**
 * URL Parser and Validator for LinkedIn Authwall Interception
 *
 * Implements:
 * - FR-1: Detect *.linkedin.com/authwall* and country-specific domains
 * - FR-2: Extract and URL-decode sessionRedirect parameter
 * - FR-6: Preserve original LinkedIn domain (e.g. kr.linkedin.com)
 * - FR-7: Narrowly scoped to profiles/content; reject login/auth paths
 * - Security: Prevent open redirects, malformed protocols, or unsafe URLs
 */

// Regex matching LinkedIn domains: www.linkedin.com, kr.linkedin.com, uk.linkedin.com, linkedin.cn, etc.
const LINKEDIN_DOMAIN_REGEX = /^(?:[a-z0-9-]+\.)*linkedin\.(?:com|cn)$/i;

// Paths representing normal authentication/registration endpoints that should never be intercepted
const DISALLOWED_AUTH_PATHS = [
  '/login',
  '/uas/login',
  '/checkpoint',
  '/signup',
  '/m/login',
  '/uas/consumer-email-challenge',
  '/uas/request-password-reset'
];

/**
 * Checks if a given URL is a LinkedIn Authwall URL (FR-1)
 *
 * @param {string|URL} url
 * @returns {boolean}
 */
function isAuthwallUrl(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    if (!LINKEDIN_DOMAIN_REGEX.test(parsed.hostname)) {
      return false;
    }
    const pathname = parsed.pathname.toLowerCase();
    return pathname === '/authwall' || pathname.startsWith('/authwall/');
  } catch {
    return false;
  }
}

/**
 * Recursively URL-decodes a string up to maxDepth levels to handle multiple encodings safely
 *
 * @param {string} value
 * @param {number} maxDepth
 * @returns {string}
 */
function safeUrlDecode(value, maxDepth = 3) {
  let decoded = value;
  for (let i = 0; i < maxDepth; i++) {
    if (!decoded || !/%[0-9a-f]{2}/i.test(decoded)) {
      break;
    }
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      // Stop on decoding errors and return best effort
      break;
    }
  }
  return decoded;
}

/**
 * Extracts and decodes the original destination URL from an Authwall URL (FR-2 & FR-6)
 *
 * @param {string|URL} authwallUrl
 * @returns {string|null} The decoded absolute target URL, or null if missing/invalid
 */
function extractSessionRedirect(authwallUrl) {
  try {
    const parsed = typeof authwallUrl === 'string' ? new URL(authwallUrl) : authwallUrl;
    if (!isAuthwallUrl(parsed)) {
      return null;
    }

    // Inspect search parameters for sessionRedirect or session_redirect
    let rawRedirect = parsed.searchParams.get('sessionRedirect') ||
                      parsed.searchParams.get('session_redirect') ||
                      parsed.searchParams.get('redirect');

    if (!rawRedirect) {
      return null;
    }

    const decodedTarget = safeUrlDecode(rawRedirect.trim());
    if (!decodedTarget) {
      return null;
    }

    // Handle relative paths (e.g. "/in/kholmatov-s") by resolving against current host
    let resolvedUrl;
    if (decodedTarget.startsWith('/')) {
      resolvedUrl = new URL(decodedTarget, parsed.origin);
    } else {
      resolvedUrl = new URL(decodedTarget);
    }

    // Only allow http: and https: protocols
    if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
      return null;
    }

    // Ensure target belongs to a legitimate LinkedIn domain (prevent open redirect attacks)
    if (!LINKEDIN_DOMAIN_REGEX.test(resolvedUrl.hostname)) {
      return null;
    }

    return resolvedUrl.toString();
  } catch {
    return null;
  }
}

/**
 * Validates whether the target URL qualifies for automatic restoration (FR-7)
 * Ensures interception is strictly confined to profiles and public content,
 * and never interferes with intentional visits to authentication or settings endpoints.
 *
 * @param {string|URL} targetUrl
 * @returns {boolean}
 */
function isRestorableTarget(targetUrl) {
  try {
    const parsed = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;

    if (!LINKEDIN_DOMAIN_REGEX.test(parsed.hostname)) {
      return false;
    }

    const path = parsed.pathname.toLowerCase();

    // Check against disallowed authentication paths
    for (const authPath of DISALLOWED_AUTH_PATHS) {
      if (path === authPath || path.startsWith(`${authPath}/`)) {
        return false;
      }
    }

    // Require target to be a profile (/in/...) or public resource (/company/, /school/, /showcase/, /posts/, /pulse/, etc.)
    const isProfile = path.startsWith('/in/') || path === '/in';
    const isPublicContent = /^\/(company|school|showcase|posts|pulse|learning)\b/i.test(path);

    return isProfile || isPublicContent;
  } catch {
    return false;
  }
}

/**
 * Full inspection pipeline: checks if the URL is an authwall URL, extracts the target,
 * and checks if the target should be restored.
 *
 * @param {string} url
 * @returns {{ isAuthwall: boolean, targetUrl: string|null, shouldRestore: boolean }}
 */
function inspectAuthwallNavigation(url) {
  if (!isAuthwallUrl(url)) {
    return { isAuthwall: false, targetUrl: null, shouldRestore: false };
  }

  const targetUrl = extractSessionRedirect(url);
  if (!targetUrl) {
    return { isAuthwall: true, targetUrl: null, shouldRestore: false };
  }

  const shouldRestore = isRestorableTarget(targetUrl);
  return {
    isAuthwall: true,
    targetUrl,
    shouldRestore
  };
}

/**
 * Detects if a URL belongs to a regional/country-specific LinkedIn subdomain
 * (e.g., kr.linkedin.com, uk.linkedin.com, de.linkedin.com, etc.).
 *
 * @param {string|URL} url
 * @returns {boolean}
 */
function isRegionalLinkedInUrl(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    const hostname = parsed.hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9-]+)\.linkedin\.(com|cn)$/i);
    if (!match) return false;
    const sub = match[1].toLowerCase();
    return sub !== 'www' && sub !== 'api' && sub !== 'static' && sub !== 'media';
  } catch {
    return false;
  }
}

/**
 * Converts a country-specific LinkedIn profile or content URL (e.g. kr.linkedin.com)
 * into its canonical www.linkedin.com form for Case B fallback.
 *
 * @param {string|URL} url
 * @returns {string|null} The canonical URL, or null if already canonical / not a regional subdomain
 */
function getCanonicalLinkedInUrl(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : new URL(url.toString());
    const hostname = parsed.hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9-]+)\.linkedin\.(com|cn)$/i);
    if (!match) return null;

    const sub = match[1].toLowerCase();
    const tld = match[2].toLowerCase();
    if (sub === 'www' || sub === 'api' || sub === 'static' || sub === 'media') {
      return null;
    }

    parsed.hostname = `www.linkedin.${tld}`;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Normalizes a LinkedIn profile URL by removing tracking query parameters and trailing slashes.
 *
 * @param {string|URL} url
 * @returns {string}
 */
function normalizeProfileUrl(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : new URL(url.toString());
    parsed.hash = '';
    // Strip common tracking and redirect parameters
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
      parsed.searchParams.delete(p);
    }
    let norm = parsed.toString();
    if (norm.endsWith('/') && parsed.pathname !== '/') {
      norm = norm.slice(0, -1);
    }
    return norm;
  } catch {
    return (url || '').trim();
  }
}

/**
 * Extracts the username / profile slug from a LinkedIn profile URL.
 * E.g., "https://uz.linkedin.com/in/javohirx" -> "javohirx"
 *
 * @param {string|URL} url
 * @returns {string} The profile slug or empty string if not found
 */
function extractProfileSlug(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : new URL(url.toString());
    const match = parsed.pathname.match(/^\/in\/([^\/\?#]+)/i);
    return match ? decodeURIComponent(match[1].trim()) : '';
  } catch {
    return '';
  }
}

// Export for ES modules and CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAuthwallUrl,
    safeUrlDecode,
    extractSessionRedirect,
    isRestorableTarget,
    inspectAuthwallNavigation,
    isRegionalLinkedInUrl,
    getCanonicalLinkedInUrl,
    normalizeProfileUrl,
    extractProfileSlug,
    LINKEDIN_DOMAIN_REGEX,
    DISALLOWED_AUTH_PATHS
  };
} else if (typeof globalThis !== 'undefined') {
  globalThis.LinkedInUrlParser = {
    isAuthwallUrl,
    safeUrlDecode,
    extractSessionRedirect,
    isRestorableTarget,
    inspectAuthwallNavigation,
    isRegionalLinkedInUrl,
    getCanonicalLinkedInUrl,
    normalizeProfileUrl,
    extractProfileSlug,
    LINKEDIN_DOMAIN_REGEX,
    DISALLOWED_AUTH_PATHS
  };
}


