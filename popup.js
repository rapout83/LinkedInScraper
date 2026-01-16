// ============================================================================
// POPUP INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['notionToken', 'databaseId']);

  if (config.notionToken) {
    document.getElementById('notionToken').value = config.notionToken;
  }

  if (config.databaseId) {
    document.getElementById('databaseId').value = config.databaseId;
  }

  // Check if we're on a LinkedIn job page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes('linkedin.com/jobs/')) {
    showStatus('Please navigate to a LinkedIn job posting page', 'info');
    document.getElementById('saveButton').disabled = true;
  }
});

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

document.getElementById('saveConfig').addEventListener('click', async () => {
  const notionToken = document.getElementById('notionToken').value.trim();
  const databaseId = document.getElementById('databaseId').value.trim();

  if (!notionToken || !databaseId) {
    showStatus('Please fill in both fields', 'error');
    return;
  }

  await chrome.storage.sync.set({
    notionToken: notionToken,
    databaseId: databaseId
  });

  showStatus('Configuration saved successfully!', 'success');
});

// ============================================================================
// JOB SAVING TO NOTION
// ============================================================================

document.getElementById('saveButton').addEventListener('click', async () => {
  const config = await chrome.storage.sync.get(['notionToken', 'databaseId']);

  if (!config.notionToken || !config.databaseId) {
    showStatus('Please configure your Notion credentials first', 'error');
    return;
  }

  showStatus('Scraping job data...', 'info');
  document.getElementById('saveButton').disabled = true;

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Execute content script to scrape data
    // allFrames: true allows scraping from iframes (needed for SPA navigation)
    // Pass the main page URL so iframe context can extract job ID
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: scrapeJobData,
      args: [tab.url]
    });

    // When allFrames: true, results contains data from all frames
    // Find the frame that has valid job data (title exists)
    console.log('[LinkedIn Scraper] Results from all frames:', results.length);

    const jobData = results.find(r => r.result && r.result.title)?.result;

    // Debug logging
    console.log('[LinkedIn Scraper] Scraped data:', jobData);

    if (!jobData) {
      throw new Error("Scraping failed: No data returned from any frame (page may not be ready)");
    }

    if (!jobData.title) {
      throw new Error(`Scraping failed: Missing title. Data: ${JSON.stringify({
        hasTitle: !!jobData.title,
        hasCompany: !!jobData.company,
        hasDescription: !!jobData.descriptionBlocks?.length,
        url: jobData.url
      })}`);
    }

    showStatus('Saving to Notion...', 'info');

    // Send to background script to save to Notion
    chrome.runtime.sendMessage({
      action: 'saveToNotion',
      jobData: jobData,
      config: config
    }, (response) => {
      if (response.success) {
        showStatus('Job saved to Notion successfully!', 'success');
      } else {
        showStatus('Error: ' + response.error, 'error');
      }
      document.getElementById('saveButton').disabled = false;
    });

  } catch (err) {
    if (err.message.includes('Receiving end does not exist')) {
      showStatus('Error: Content script is not running. Please refresh the LinkedIn tab and try again.', 'error');
    } else {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    document.getElementById('saveButton').disabled = false;
  }
});

// ============================================================================
// JOB DATA SCRAPING
// ============================================================================

/**
 * Scrapes job data from a LinkedIn job posting page.
 * Uses text parsing instead of CSS selectors due to LinkedIn's obfuscated class names.
 * This function is injected into the page context via chrome.scripting.executeScript.
 * @param {string} mainPageUrl - The URL of the main page (needed when running in iframe)
 * @returns {Promise<Object>} Job data including title, company, location, description, etc.
 */
function scrapeJobData(mainPageUrl) {
  return new Promise((resolve, reject) => {
    const MAX_WAIT_TIME_MS = 10000;
    const MAX_RETRY_ATTEMPTS = 5;
    let observer = null;
    let attempts = 0;

    // Set timeout to prevent infinite waiting
    const timeout = setTimeout(() => {
      if (observer) observer.disconnect();
      reject(new Error("Timeout: Job content did not load after 10 seconds."));
    }, MAX_WAIT_TIME_MS);

    /**
     * Checks if the page has enough content to scrape.
     * @returns {boolean} True if page is ready for scraping
     */
    const isPageReady = () => {
      const main = document.querySelector('main');
      return main && main.innerText && main.innerText.length > 100;
    };

    /**
     * Executes the actual scraping logic once the page is ready.
     * @returns {Object|null} Scraped job data or null if not ready
     */
    const executeScraping = () => {
      if (!isPageReady()) return null;

      attempts++;

      const main = document.querySelector('main');
      const mainText = main.innerText;
      const lines = mainText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Initialize job data object
      const data = {
        url: '',
        companyLogo: '',
        company: '',
        title: '',
        location: '',
        workType: '',
        salary: '',
        description: '',
        descriptionBlocks: [],
        contactPerson: '',
        contactPersonUrl: ''
      };

      // === Extract Job URL ===
      const jobIdMatch = mainPageUrl.match(/(\d{10})/);
      if (jobIdMatch) {
        data.url = `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}`;
      }

      // === Extract Company Name (most reliable via ARIA label) ===
      const companyElem = document.querySelector('[aria-label*="Company,"]');
      if (companyElem) {
        const ariaLabel = companyElem.getAttribute('aria-label');
        data.company = ariaLabel.replace('Company, ', '').replace(/\.$/, '');
      }

      // Fallback: try to find company in first few lines
      if (!data.company) {
        for (let i = 0; i < Math.min(lines.length, 10); i++) {
          if (lines[i].length > 2 && lines[i].length < 100 && !lines[i].includes('·')) {
            data.company = lines[i];
            break;
          }
        }
      }

      // === Extract Job Title (from page title) ===
      const pageTitle = document.title;
      if (pageTitle) {
        const parts = pageTitle.split('|');
        if (parts.length > 0) {
          data.title = parts[0].trim();
        }
      }

      // Fallback: first heading or second line
      if (!data.title) {
        const h1 = document.querySelector('h1');
        data.title = h1 ? h1.innerText.trim() : lines[1] || '';
      }

      // === Extract Location ===
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        const line = lines[i];
        // Look for location patterns: "City, State" or "City, Country"
        if (line.match(/[A-Z][a-z]+,\s*[A-Z]/) ||
            line.includes('United Kingdom') ||
            line.includes('United States') ||
            line.includes('Remote')) {
          data.location = line.split('·')[0].trim();
          break;
        }
      }

      // === Extract Work Type (Remote/Hybrid/On-site) ===
      const workTypeKeywords = ['Remote', 'Hybrid', 'On-site'];
      for (const keyword of workTypeKeywords) {
        if (mainText.includes(keyword)) {
          data.workType = keyword;
          break;
        }
      }

      // === Extract Salary ===
      const salaryRegex = /([£$€])\s*\d[\d,]*K/i;
      for (const line of lines) {
        if (salaryRegex.test(line)) {
          data.salary = line;
          break;
        }
      }

      // === Extract Company Logo ===
      const logoImg = document.querySelector('img[alt*="logo" i], img[src*="company" i]');
      if (logoImg) {
        data.companyLogo = logoImg.src;
      }

      // === Extract Description ===
      const aboutIdx = lines.findIndex(l => l === 'About the job' || l.includes('About the job'));
      if (aboutIdx !== -1) {
        // Get description text (limit to reasonable length)
        const descLines = lines.slice(aboutIdx + 1, aboutIdx + 100);
        data.description = descLines.join('\n');

        // Convert to Notion blocks (paragraphs for now, since we can't parse rich formatting reliably)
        const descriptionBlocks = [];
        let currentParagraph = [];

        for (const line of descLines) {
          if (line.length === 0) {
            // Empty line = paragraph break
            if (currentParagraph.length > 0) {
              descriptionBlocks.push({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{
                    text: { content: currentParagraph.join('\n') }
                  }]
                }
              });
              currentParagraph = [];
            }
          } else {
            currentParagraph.push(line);
          }
        }

        // Add remaining paragraph
        if (currentParagraph.length > 0) {
          descriptionBlocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                text: { content: currentParagraph.join('\n') }
              }]
            }
          });
        }

        data.descriptionBlocks = descriptionBlocks.length > 0 ? descriptionBlocks : [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: 'No description found.' } }]
          }
        }];
      } else {
        // No "About the job" found
        data.descriptionBlocks = [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: 'Description not found.' } }]
          }
        }];
      }

      // === Extract Contact Person ===
      const contactLink = document.querySelector('a[href*="/in/"]');
      if (contactLink) {
        data.contactPerson = contactLink.innerText.trim();
        data.contactPersonUrl = contactLink.href;
      }

      // === Validation: Check if we have minimum required data ===
      const hasMinimumData = data.title && data.company;

      if (hasMinimumData) {
        clearTimeout(timeout);
        if (observer) observer.disconnect();
        return data;
      } else if (attempts < MAX_RETRY_ATTEMPTS) {
        // Not enough data yet, but haven't exceeded retry limit
        return null;
      } else {
        // Exceeded retry limit
        clearTimeout(timeout);
        if (observer) observer.disconnect();
        reject(new Error(`Insufficient data after ${MAX_RETRY_ATTEMPTS} attempts. Title: ${data.title}, Company: ${data.company}`));
        return null;
      }
    };

    // Try scraping immediately
    const initialData = executeScraping();
    if (initialData) {
      return resolve(initialData);
    }

    // If not ready, observe DOM changes until content loads
    observer = new MutationObserver(() => {
      const data = executeScraping();
      if (data) {
        resolve(data);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Displays a status message to the user.
 * @param {string} message - The message to display
 * @param {string} type - Message type: 'success', 'error', or 'info'
 */
function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;

  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}
