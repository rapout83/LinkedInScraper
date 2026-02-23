// ============================================================================
// CONTENT SCRIPT FOR LINKEDIN JOB LISTINGS PAGES
// Filters out dismissed jobs, blocked companies, and applied jobs
// ============================================================================

console.log('[LinkedIn Filter] Content script loaded on listings page');

// Global state
let dismissedJobs = {};
let blockedCompanies = [];
let settings = {
  hideAppliedJobs: true,
  hideWontRecommend: true
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the filter by loading settings from storage and setting up observers
 */
async function init() {
  console.log('[LinkedIn Filter] Initializing...');

  // Load settings from storage
  await loadSettings();

  // Process existing job cards
  processAllJobCards();

  // Set up X button listeners for existing cards
  setupDismissButtonListeners();

  // Set up MutationObserver to watch for new job cards (infinite scroll)
  setupObserver();

  // Listen for storage changes (when user updates filters in popup)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      console.log('[LinkedIn Filter] Storage changed, reloading settings');
      loadSettings().then(() => {
        // Re-process all cards with new settings
        processAllJobCards();
      });
    }
  });

  console.log('[LinkedIn Filter] Initialization complete');
}

/**
 * Load filter settings from chrome.storage.local
 */
async function loadSettings() {
  const data = await chrome.storage.local.get(['dismissedJobs', 'blockedCompanies', 'settings']);

  dismissedJobs = data.dismissedJobs || {};
  blockedCompanies = data.blockedCompanies || [];
  settings = data.settings || {
    hideAppliedJobs: true,
    hideWontRecommend: true
  };

  console.log('[LinkedIn Filter] Loaded settings:', {
    dismissedCount: Object.keys(dismissedJobs).length,
    blockedCount: blockedCompanies.length,
    settings
  });
}

// ============================================================================
// JOB CARD PROCESSING
// ============================================================================

/**
 * Process all job cards currently on the page
 */
function processAllJobCards() {
  const jobCards = findJobCards();
  console.log(`[LinkedIn Filter] Processing ${jobCards.length} job cards`);

  jobCards.forEach(card => processJobCard(card));
}

/**
 * Find all job card elements on the page
 * LinkedIn uses different selectors depending on the page type
 */
function findJobCards() {
  // Common selectors for LinkedIn job cards
  const selectors = [
    'li.jobs-search-results__list-item',
    'li.scaffold-layout__list-item',
    'div.job-card-container',
    'div.jobs-search-results__list-item',
    '[data-job-id]'
  ];

  const cards = [];
  selectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      // Avoid duplicates
      if (!cards.includes(el)) {
        cards.push(el);
      }
    });
  });

  return cards;
}

/**
 * Process a single job card - extract data and apply filters
 */
function processJobCard(card) {
  // Skip if already processed
  if (card.dataset.linkedinFilterProcessed === 'true') {
    return;
  }

  // Extract job data
  const jobData = extractJobData(card);

  if (!jobData.id) {
    // Can't filter without job ID, skip
    return;
  }

  // Mark as processed
  card.dataset.linkedinFilterProcessed = 'true';

  // Apply filters
  let shouldHide = false;
  let reason = '';

  // 1. Check if job is dismissed
  if (dismissedJobs[jobData.id]) {
    shouldHide = true;
    reason = 'dismissed';
  }

  // 2. Check if company is blocked
  if (blockedCompanies.some(company => {
    const normalizedBlocked = company.toLowerCase().trim();
    const normalizedCard = jobData.company.toLowerCase().trim();
    return normalizedCard.includes(normalizedBlocked) || normalizedBlocked.includes(normalizedCard);
  })) {
    shouldHide = true;
    reason = 'blocked company';
  }

  // 3. Check if job is applied
  if (settings.hideAppliedJobs && jobData.isApplied) {
    shouldHide = true;
    reason = 'applied';
  }

  // 4. Check if job has "We won't recommend" message
  if (settings.hideWontRecommend && jobData.hasWontRecommendMessage) {
    shouldHide = true;
    reason = 'won\'t recommend';

    // Auto-add to dismissed list
    if (!dismissedJobs[jobData.id]) {
      addToDismissedList(jobData);
    }
  }

  // Apply hiding
  if (shouldHide) {
    hideJobCard(card, reason);
  } else {
    // Make sure card is visible (in case filters were updated)
    showJobCard(card);
  }
}

// ============================================================================
// DISMISS BUTTON (X BUTTON) INTERCEPTION
// ============================================================================

/**
 * Set up click listeners on all X (dismiss) buttons in job cards
 */
function setupDismissButtonListeners() {
  const jobCards = findJobCards();

  jobCards.forEach(card => {
    setupDismissButtonForCard(card);
  });
}

/**
 * Set up dismiss button listener for a single card
 */
function setupDismissButtonForCard(card) {
  // Skip if already set up
  if (card.dataset.dismissListenerAdded === 'true') {
    return;
  }

  // Find the dismiss/X button - LinkedIn uses various selectors
  const dismissButtonSelectors = [
    'button[aria-label*="Dismiss"]',
    'button[aria-label*="dismiss"]',
    'button.dismiss',
    'button.job-card-container__action',
    '[data-test-job-card-dismiss]',
    'button[data-control-name*="dismiss"]'
  ];

  let dismissButton = null;
  for (const selector of dismissButtonSelectors) {
    dismissButton = card.querySelector(selector);
    if (dismissButton) break;
  }

  // Also try to find X icon buttons without specific dismiss labels
  if (!dismissButton) {
    const buttons = card.querySelectorAll('button');
    dismissButton = Array.from(buttons).find(btn => {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const hasDismissIcon = btn.querySelector('svg[data-test-icon="dismiss-small"]');
      const hasXIcon = btn.querySelector('svg[data-test-icon="x-small"]');
      return ariaLabel.toLowerCase().includes('dismiss') || hasDismissIcon || hasXIcon;
    });
  }

  if (!dismissButton) {
    // No dismiss button found, skip
    return;
  }

  // Add click listener
  dismissButton.addEventListener('click', async (e) => {
    console.log('[LinkedIn Filter] Dismiss button clicked');

    // Extract job data
    const jobData = extractJobData(card);

    if (jobData.id) {
      // Add to dismissed list
      await addToDismissedList(jobData);
      console.log('[LinkedIn Filter] Auto-dismissed job:', jobData.id, jobData.title);

      // Immediately hide the card (don't wait for LinkedIn's animation)
      hideJobCard(card, 'manually dismissed');
    }
  }, { capture: true }); // Use capture to intercept before LinkedIn's handler

  // Mark as set up
  card.dataset.dismissListenerAdded = 'true';
}

// ============================================================================
// JOB DATA EXTRACTION
// ============================================================================

/**
 * Extract job data from a job card element
 */
function extractJobData(card) {
  const data = {
    id: null,
    title: '',
    company: '',
    isApplied: false,
    hasWontRecommendMessage: false
  };

  // Extract Job ID (multiple possible locations)
  data.id = card.dataset.jobId ||
            card.getAttribute('data-occludable-job-id') ||
            extractJobIdFromUrl(card);

  // Extract Title
  const titleElement = card.querySelector('.job-card-list__title, .job-card-container__link, [data-job-title]');
  if (titleElement) {
    data.title = titleElement.innerText?.trim() || titleElement.textContent?.trim() || '';
  }

  // Extract Company
  const companyElement = card.querySelector(
    '.job-card-container__primary-description, ' +
    '.job-card-container__company-name, ' +
    '[data-job-company-name], ' +
    '.artdeco-entity-lockup__subtitle'
  );
  if (companyElement) {
    data.company = companyElement.innerText?.trim() || companyElement.textContent?.trim() || '';
    // Remove extra text like " · 1 day ago"
    data.company = data.company.split('·')[0].trim();
  }

  // Check if Applied - look for "Applied" text anywhere in the card
  const cardTextLower = (card.innerText || card.textContent || '').toLowerCase();
  data.isApplied = cardTextLower.includes('applied') &&
                   !cardTextLower.includes('easy apply'); // Exclude "Easy Apply" false positives

  // Check for "We won't show you" message
  const cardText = card.innerText || card.textContent || '';
  data.hasWontRecommendMessage = cardText.includes('We won\'t show you this job again') ||
                                  cardText.includes('We won't show you this job again') ||
                                  cardText.includes('won\'t show you') ||
                                  cardText.includes('We won\'t recommend this job');

  return data;
}

/**
 * Extract job ID from a URL within the card
 */
function extractJobIdFromUrl(card) {
  const links = card.querySelectorAll('a[href*="/jobs/view/"]');
  for (const link of links) {
    const match = link.href.match(/\/jobs\/view\/(\d+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Hide a job card
 */
function hideJobCard(card, reason) {
  card.style.display = 'none';
  card.dataset.linkedinFilterHidden = 'true';
  card.dataset.linkedinFilterReason = reason;
  console.log(`[LinkedIn Filter] Hidden job card (${reason}):`, card.dataset.jobId);
}

/**
 * Show a job card (unhide)
 */
function showJobCard(card) {
  if (card.dataset.linkedinFilterHidden === 'true') {
    card.style.display = '';
    card.dataset.linkedinFilterHidden = 'false';
    delete card.dataset.linkedinFilterReason;
    console.log(`[LinkedIn Filter] Unhidden job card:`, card.dataset.jobId);
  }
}

/**
 * Add a job to the dismissed list and save to storage
 */
async function addToDismissedList(jobData) {
  dismissedJobs[jobData.id] = {
    id: jobData.id,
    title: jobData.title,
    company: jobData.company,
    dismissedAt: Date.now()
  };

  await chrome.storage.local.set({ dismissedJobs });
  console.log('[LinkedIn Filter] Added to dismissed list:', jobData.id);
}

// ============================================================================
// MUTATION OBSERVER (for infinite scroll)
// ============================================================================

/**
 * Set up MutationObserver to watch for new job cards added to the DOM
 */
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    let hasNewCards = false;

    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        // Check if the added node is a job card or contains job cards
        if (node.nodeType === 1) { // Element node
          if (isJobCard(node)) {
            processJobCard(node);
            setupDismissButtonForCard(node);
            hasNewCards = true;
          } else {
            // Check if the node contains job cards
            const cards = node.querySelectorAll ? findJobCardsIn(node) : [];
            if (cards.length > 0) {
              cards.forEach(card => {
                processJobCard(card);
                setupDismissButtonForCard(card);
              });
              hasNewCards = true;
            }
          }
        }
      });
    });

    if (hasNewCards) {
      console.log('[LinkedIn Filter] New job cards detected and processed');
    }
  });

  // Observe the entire body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('[LinkedIn Filter] MutationObserver set up');
}

/**
 * Check if an element is a job card
 */
function isJobCard(element) {
  return element.matches && (
    element.matches('li.jobs-search-results__list-item') ||
    element.matches('li.scaffold-layout__list-item') ||
    element.matches('div.job-card-container') ||
    element.matches('div.jobs-search-results__list-item') ||
    element.hasAttribute('data-job-id')
  );
}

/**
 * Find job cards within a container element
 */
function findJobCardsIn(container) {
  if (!container.querySelectorAll) return [];

  const selectors = [
    'li.jobs-search-results__list-item',
    'li.scaffold-layout__list-item',
    'div.job-card-container',
    'div.jobs-search-results__list-item',
    '[data-job-id]'
  ];

  const cards = [];
  selectors.forEach(selector => {
    const elements = container.querySelectorAll(selector);
    elements.forEach(el => {
      if (!cards.includes(el)) {
        cards.push(el);
      }
    });
  });

  return cards;
}

// ============================================================================
// MESSAGE LISTENER (for popup actions)
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'dismissCurrentJob') {
    // This will be handled on the job view page, not listings page
    sendResponse({ success: false, message: 'Not applicable on listings page' });
  }

  if (request.action === 'reprocessCards') {
    // Force reprocess all cards (after settings change)
    console.log('[LinkedIn Filter] Reprocessing all cards');
    processAllJobCards();
    sendResponse({ success: true });
  }
});

// ============================================================================
// START
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
