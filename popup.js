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
 * Hybrid approach: Uses stable extraction (ARIA, document.title) for metadata,
 * and flexible DOM traversal with rich text formatting for descriptions.
 * This function is injected into the page context via chrome.scripting.executeScript.
 * @param {string} mainPageUrl - The URL of the main page (needed when running in iframe)
 * @returns {Promise<Object>} Job data including title, company, location, description, etc.
 */
function scrapeJobData(mainPageUrl) {
  // Rich text extraction helpers (for description formatting)
  let currentParagraphBuffer = [];
  let pendingSpace = false;
  const BREAK_MARKER = { type: 'BREAK' };

  /**
   * Filters out empty or invalid rich text items while preserving intentional spaces.
   */
  const cleanRichTextArray = (richTextArray) => {
    return richTextArray.filter(item => {
      if (!item || !item.text) return false;
      const content = item.text.content;
      return content.trim().length > 0 || content === ' ';
    });
  };

  /**
   * Checks if a rich text array contains any non-whitespace content.
   */
  const hasMeaningfulContent = (richTextArray) => {
    const fullText = richTextArray.map(item => item.text?.content || '').join('');
    return fullText.trim().length > 0;
  };

  /**
   * Finalizes the current paragraph buffer and adds it to the blocks array if it has content.
   */
  const finalizeParagraph = (blocksArray) => {
    const cleanedBuffer = cleanRichTextArray(currentParagraphBuffer);
    if (hasMeaningfulContent(cleanedBuffer)) {
      blocksArray.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: cleanedBuffer }
      });
    }
    currentParagraphBuffer = [];
    pendingSpace = false;
  };

  /**
   * Recursively extracts rich text with formatting from a DOM node.
   * Handles text nodes, formatting tags (bold, italic), links, and line breaks.
   */
  const extractInlineRichText = (node, isList = false) => {
    let richTextArray = [];

    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 3) { // Text Node
        const content = child.nodeValue;
        if (content && content.length > 0) {
          richTextArray.push({ text: { content: content } });
        }
      } else if (child.nodeType === 1) { // Element Node
        if (child.tagName === 'BR') {
          richTextArray.push(isList ? { text: { content: ' ' } } : BREAK_MARKER);
          return;
        }

        // Recursively process nested block elements as inline text
        if (child.tagName === 'P' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'LI') {
          const nestedContent = extractInlineRichText(child, isList);
          richTextArray.push(...nestedContent);
          return;
        }

        // Process inline formatting elements
        const nestedContent = extractInlineRichText(child, isList);
        const isBold = child.tagName === 'STRONG' || child.tagName === 'B';
        const isItalic = child.tagName === 'I' || child.tagName === 'EM';
        const isLink = child.tagName === 'A' && child.href;

        nestedContent.forEach(item => {
          if (item.type !== 'BREAK' && item.text) {
            item.annotations = item.annotations || {};
            if (isBold) item.annotations.bold = true;
            if (isItalic) item.annotations.italic = true;
            if (isLink) item.href = child.href;
          }
        });
        richTextArray.push(...nestedContent);
      }
    });
    return richTextArray;
  };

  const extractListItemRichText = (node) => extractInlineRichText(node, true);

  /**
   * Finds the job description container using multiple flexible strategies.
   */
  const findDescriptionContainer = () => {
    const main = document.querySelector('main');
    if (!main) return document.body;

    // Strategy 1: Look for "About the job" heading and find the LARGEST ancestor container
    const aboutElements = Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent?.trim();
      return (text === 'About the job' || text?.includes('About the job')) &&
             el.tagName !== 'SCRIPT' &&
             el.children.length === 0; // Leaf node
    });

    if (aboutElements.length > 0) {
      let container = aboutElements[0].parentElement;
      let bestContainer = container;

      // Traverse up to find the largest container that still seems to be job description
      // Stop at main or when we hit a container that seems too broad
      while (container && container !== main && container !== document.body) {
        const textLength = container.innerText?.length || 0;

        // Keep going up if we find a larger container with substantial content
        // Job descriptions are typically 1000+ characters
        if (textLength > 500) {
          bestContainer = container;
        }

        // Stop if container is unreasonably large (likely includes non-description content)
        if (textLength > 20000) {
          break;
        }

        container = container.parentElement;
      }

      // If the best container we found is very large and has good structure, use it
      if (bestContainer && bestContainer.innerText?.length > 500) {
        return bestContainer;
      }
    }

    // Strategy 2: Look for article or section with substantial content
    const article = document.querySelector('main article');
    if (article) {
      const textLength = article.innerText?.length || 0;
      const elemCount = article.querySelectorAll('p, ul, ol, h1, h2, h3').length;
      if (textLength > 500 && elemCount > 3) {
        return article;
      }
    }

    // Strategy 3: Find the section/div within main with most comprehensive content
    if (main) {
      const candidates = Array.from(main.querySelectorAll('section, div, article'))
        .filter(el => {
          const textLength = el.innerText?.length || 0;
          const elemCount = el.querySelectorAll('p, li, h2, h3').length;
          return textLength > 500 && elemCount > 5;
        });

      if (candidates.length > 0) {
        // Return the one with most text content (likely the full description)
        return candidates.reduce((best, current) => {
          const bestLength = best.innerText?.length || 0;
          const currentLength = current.innerText?.length || 0;
          return currentLength > bestLength ? current : best;
        });
      }
    }

    // Strategy 4: Fallback to main
    return main;
  };

  return new Promise((resolve, reject) => {
    const MAX_WAIT_TIME_MS = 10000;
    const MAX_RETRY_ATTEMPTS = 5;
    let observer = null;
    let attempts = 0;

    const timeout = setTimeout(() => {
      if (observer) observer.disconnect();
      reject(new Error("Timeout: Job content did not load after 10 seconds."));
    }, MAX_WAIT_TIME_MS);

    /**
     * Checks if the page has enough content to scrape.
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
      // First try to find location via ARIA label
      const locationElem = document.querySelector('[aria-label*="Location,"]');
      if (locationElem) {
        const ariaLabel = locationElem.getAttribute('aria-label');
        data.location = ariaLabel.replace('Location, ', '').replace(/\.$/, '');
      }

      // Fallback: Look for location patterns in text
      if (!data.location) {
        for (let i = 0; i < Math.min(lines.length, 20); i++) {
          const line = lines[i];
          // More specific location patterns to avoid matching job titles
          // Look for: "City, State/Country" but not "Title, Word"
          const isLocationPattern = (
            // Has comma followed by 2-letter state code (e.g., "Austin, TX")
            line.match(/[A-Z][a-z]+,\s*[A-Z]{2}(?:\s|$)/) ||
            // Contains country names
            line.includes('United Kingdom') ||
            line.includes('United States') ||
            line.includes('Canada') ||
            line.includes('Australia') ||
            // Remote work indicators
            line.match(/\b(Remote|Hybrid|On-site)\b/)
          );

          // Exclude lines that look like job titles (contain words like Director, Manager, Engineer)
          const looksLikeJobTitle = line.match(/\b(Director|Manager|Engineer|Lead|Senior|Junior|Analyst|Specialist|Coordinator)\b/i);

          if (isLocationPattern && !looksLikeJobTitle) {
            data.location = line.split('·')[0].trim();
            break;
          }
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

      // === Extract Description with Rich Text Formatting ===
      const descriptionContainer = findDescriptionContainer();
      const contentBlocks = [];

      if (descriptionContainer) {
        currentParagraphBuffer = [];
        pendingSpace = false;

        // Recursive function to process DOM nodes
        const processNode = (node) => {
          // Skip comment nodes
          if (node.nodeType === 8) return;

          // Handle text nodes
          if (node.nodeType === 3) {
            const text = node.nodeValue;

            if (text && text.trim().length === 0) {
              pendingSpace = true;
              return;
            }

            if (pendingSpace && currentParagraphBuffer.length > 0) {
              currentParagraphBuffer.push({ text: { content: ' ' } });
            }
            pendingSpace = false;

            if (text && text.length > 0) {
              currentParagraphBuffer.push({ text: { content: text } });
            }

          } else if (node.nodeType === 1) { // Element nodes
            if (pendingSpace && currentParagraphBuffer.length > 0) {
              currentParagraphBuffer.push({ text: { content: ' ' } });
              pendingSpace = false;
            }

            if (node.tagName === 'BR') {
              finalizeParagraph(contentBlocks);
              pendingSpace = false;
              return;
            }

            // Check if this is a container element that should be recursively traversed
            const isContainer = ['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV'].includes(node.tagName);

            if (isContainer) {
              // Recursively process children of container elements
              Array.from(node.childNodes).forEach(processNode);
              return;
            }

            // Check if this is a list element
            const isList = node.tagName === 'UL' || node.tagName === 'OL';

            // Check if this is a paragraph element
            const isParagraph = node.tagName === 'P' ||
              (node.tagName === 'SPAN' && node.children.length === 1 && node.firstElementChild.tagName === 'P');

            // Handle list blocks
            if (isList) {
              finalizeParagraph(contentBlocks);

              const listType = node.tagName === 'UL' ? 'bulleted_list_item' : 'numbered_list_item';

              Array.from(node.children).forEach(listItemNode => {
                if (listItemNode.tagName === 'LI') {
                  const rawListItemContent = extractListItemRichText(listItemNode);
                  const listItemContent = cleanRichTextArray(rawListItemContent);

                  if (listItemContent.length > 0) {
                    contentBlocks.push({
                      object: 'block',
                      type: listType,
                      [listType]: {
                        rich_text: listItemContent
                      }
                    });
                  }
                }
              });

              currentParagraphBuffer = [];
              pendingSpace = false;
              return;
            }

            // Handle paragraph blocks
            if (isParagraph) {
              finalizeParagraph(contentBlocks);

              const paragraphElement = node.tagName === 'P' ? node : node.firstElementChild;
              const rawParagraphContent = extractInlineRichText(paragraphElement);
              const paragraphContent = cleanRichTextArray(rawParagraphContent);

              if (hasMeaningfulContent(paragraphContent)) {
                contentBlocks.push({
                  object: 'block',
                  type: 'paragraph',
                  paragraph: {
                    rich_text: paragraphContent
                  }
                });
              }

              currentParagraphBuffer = [];
              pendingSpace = false;
              return;
            }

            // Handle inline elements (bold, italic, links, etc.)
            const nodeContent = extractInlineRichText(node);

            // Check for internal line breaks
            const breakIndex = nodeContent.findIndex(item => item.type === 'BREAK');
            if (breakIndex !== -1) {
              currentParagraphBuffer.push(...nodeContent.slice(0, breakIndex));
              finalizeParagraph(contentBlocks);
              currentParagraphBuffer.push(...nodeContent.slice(breakIndex + 1));
              pendingSpace = false;
              return;
            }

            currentParagraphBuffer.push(...nodeContent);
          }
        };

        // Start processing from the description container
        Array.from(descriptionContainer.childNodes).forEach(processNode);

        // Finalize any remaining content
        finalizeParagraph(contentBlocks);
      }

      data.descriptionBlocks = contentBlocks.length > 0 ? contentBlocks : [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: 'No description found.' } }]
        }
      }];

      // === Extract Contact Person ===
      // Look for "Meet the hiring team" section first
      const hiringTeamElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.textContent?.trim();
        return text === 'Meet the hiring team' || text?.includes('Meet the hiring team');
      });

      let contactLink = null;
      if (hiringTeamElements.length > 0) {
        // Find the first /in/ link after the "Meet the hiring team" heading
        let container = hiringTeamElements[0].parentElement;
        while (container && container !== document.body) {
          contactLink = container.querySelector('a[href*="/in/"]');
          if (contactLink) break;
          container = container.parentElement;
        }
      }

      // Fallback: Look for any profile link, but prefer ones that are not in navigation
      if (!contactLink) {
        const allProfileLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));
        // Filter out navigation links (typically in header/nav)
        contactLink = allProfileLinks.find(link => {
          const nav = link.closest('nav, header');
          return !nav; // Not in navigation
        });
      }

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
