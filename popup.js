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
 * This function is injected into the page context via chrome.scripting.executeScript.
 * @param {string} mainPageUrl - The URL of the main page (needed when running in iframe)
 * @returns {Promise<Object>} Job data including title, company, location, description, etc.
 */
function scrapeJobData(mainPageUrl) {
  // State variables for building Notion-compatible description blocks
  let currentParagraphBuffer = [];
  let pendingSpace = false; // Flag to manage missing spaces between elements
  const BREAK_MARKER = { type: 'BREAK' };

  /**
   * Filters out empty or invalid rich text items while preserving intentional spaces.
   * @param {Array} richTextArray - Array of Notion rich text objects
   * @returns {Array} Cleaned array of rich text objects
   */
  const cleanRichTextArray = (richTextArray) => {
    return richTextArray.filter(item => {
      if (!item || !item.text) return false;
      const content = item.text.content;
      // Keep meaningful content or intentional single spaces
      return content.trim().length > 0 || content === ' ';
    });
  };

  /**
   * Checks if a rich text array contains any non-whitespace content.
   * @param {Array} richTextArray - Array of Notion rich text objects
   * @returns {boolean} True if content has meaningful text
   */
  const hasMeaningfulContent = (richTextArray) => {
    const fullText = richTextArray.map(item => item.text?.content || '').join('');
    return fullText.trim().length > 0;
  };

  /**
   * Finalizes the current paragraph buffer and adds it to the blocks array if it has content.
   * @param {Array} blocksArray - Array to push the finalized paragraph block to
   */
  const finalizeParagraph = (blocksArray) => {
    const cleanedBuffer = cleanRichTextArray(currentParagraphBuffer);

    if (hasMeaningfulContent(cleanedBuffer)) {
      blocksArray.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: cleanedBuffer
        }
      });
    }
    currentParagraphBuffer = [];
    pendingSpace = false;
  };

  /**
   * Recursively extracts rich text with formatting from a DOM node.
   * Handles text nodes, formatting tags (bold, italic), links, and line breaks.
   * @param {Node} node - The DOM node to extract text from
   * @param {boolean} isList - Whether this node is within a list item
   * @returns {Array} Array of rich text objects with formatting
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
          // In lists, BR becomes a space; in paragraphs, it's a soft break
          if (isList) {
            richTextArray.push({ text: { content: ' ' } });
          } else {
            richTextArray.push(BREAK_MARKER);
          }
          return;
        }

        // Recursively process nested block elements as inline text
        if (child.tagName === 'P' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'LI') {
          const nestedContent = extractInlineRichText(child, isList);
          richTextArray.push(...nestedContent);
          return;
        }

        // Process inline formatting elements (bold, italic, links, etc.)
        const nestedContent = extractInlineRichText(child, isList);
        const isBold = child.tagName === 'STRONG' || child.tagName === 'B';
        const isItalic = child.tagName === 'I' || child.tagName === 'EM';
        const isLink = child.tagName === 'A' && child.href;

        // Apply formatting annotations to nested content
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

  /**
   * Helper to extract rich text from list items.
   * @param {Node} node - The list item node
   * @returns {Array} Array of rich text objects
   */
  const extractListItemRichText = (node) => extractInlineRichText(node, true);

  return new Promise((resolve, reject) => {
    const MAX_WAIT_TIME_MS = 10000;
    let observer = null;

    // Set timeout to prevent infinite waiting
    const timeout = setTimeout(() => {
      if (observer) observer.disconnect();
      reject(new Error("Timeout: Job content did not load after 10 seconds."));
    }, MAX_WAIT_TIME_MS);

    /**
     * Checks if all critical elements are loaded on the page.
     * @returns {boolean} True if page is ready for scraping
     */
    const isPageReady = () => {
      const titleElement = document.querySelector('h1.t-24');
      const companyElement = document.querySelector('.job-details-jobs-unified-top-card__company-name');
      const descriptionContainer = document.querySelector('.jobs-description__content .mt4, .jobs-box__html-content .mt4');

      // All critical elements must be present AND have content
      return titleElement && titleElement.textContent?.trim() &&
             companyElement && companyElement.textContent?.trim() &&
             descriptionContainer && descriptionContainer.textContent?.trim();
    };

    /**
     * Executes the actual scraping logic once the page is ready.
     * @returns {Object|null} Scraped job data or null if not ready
     */
    const executeScraping = () => {
      // Check if all critical content is loaded
      if (isPageReady()) {
        clearTimeout(timeout);
        if (observer) observer.disconnect();

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
          contactPerson: '',
          contactPersonUrl: ''
        };

        // Extract job ID from main page URL and construct canonical LinkedIn job URL
        // Use mainPageUrl (passed as parameter) instead of window.location.href
        // because this script may run in an iframe context
        const jobIdMatch = mainPageUrl.match(/(\d{10})/);
        if (jobIdMatch) {
          data.url = `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}`;
        }

        // === Basic Job Information ===

        const logoElement = document.querySelector('img.EntityPhoto-square-2, .job-details-jobs-unified-top-card__container--two-pane img.EntityPhoto-square-1');
        data.companyLogo = logoElement ? logoElement.src : '';

        const companyElement = document.querySelector('.job-details-jobs-unified-top-card__company-name a');
        data.company = companyElement ? companyElement.textContent.trim() : '';

        const titleElement = document.querySelector('h1.t-24');
        data.title = titleElement ? titleElement.textContent.trim() : '';

        const locationElement = document.querySelector('.job-details-jobs-unified-top-card__primary-description-container span.tvm__text');
        data.location = locationElement ? locationElement.textContent.trim() : '';

        // === Extract Work Type and Salary from Info Bubbles ===

        const bubbles = document.querySelectorAll('.job-details-fit-level-preferences span.tvm__text');
        const workTypeKeywords = ['Remote', 'Hybrid', 'On-site'];
        const salaryRegex = /([£$€])\s*\d[\d,]*K/i;

        for (const bubbleElement of bubbles) {
          const bubbleText = bubbleElement.textContent.trim();

          // Check for work type
          if (!data.workType) {
            const matchedType = workTypeKeywords.find(keyword => bubbleText.includes(keyword));
            if (matchedType) data.workType = matchedType;
          }

          // Check for salary
          if (!data.salary && salaryRegex.test(bubbleText)) {
            data.salary = bubbleText;
          }

          // Exit early if both values are found
          if (data.workType && data.salary) break;
        }

        // === Parse Job Description into Notion Blocks ===

        const descriptionContainer = document.querySelector('.jobs-description__content .mt4, .jobs-box__html-content .mt4');
        const contentBlocks = [];

        if (descriptionContainer) {
          const mainParagraph = descriptionContainer.querySelector('p[dir="ltr"]');
          // LinkedIn uses different formats: old has inner <p>, new uses direct container
          const iterationRoot = mainParagraph || descriptionContainer;

          currentParagraphBuffer = [];
          pendingSpace = false;

          Array.from(iterationRoot.childNodes).forEach(node => {
            // Skip HTML comment nodes
            if (node.nodeType === 8) return;

            // Handle text nodes
            if (node.nodeType === 3) {
              const text = node.nodeValue;

              // Whitespace-only text becomes a pending space
              if (text && text.trim().length === 0) {
                pendingSpace = true;
                return;
              }

              // Insert pending space if needed
              if (pendingSpace && currentParagraphBuffer.length > 0) {
                currentParagraphBuffer.push({ text: { content: ' ' } });
              }
              pendingSpace = false;

              if (text && text.length > 0) {
                currentParagraphBuffer.push({ text: { content: text } });
              }

            } else if (node.nodeType === 1) { // Element nodes

              // Insert pending space before processing element
              if (pendingSpace && currentParagraphBuffer.length > 0) {
                currentParagraphBuffer.push({ text: { content: ' ' } });
                pendingSpace = false;
              }

              // BR tag creates a paragraph break
              if (node.tagName === 'BR') {
                finalizeParagraph(contentBlocks);
                pendingSpace = false;
                return;
              }

              // Check for list containers (UL or OL)
              const listContainer = node.tagName === 'UL' || node.tagName === 'OL' ? node : node.querySelector('ul, ol');

              // Check for paragraph elements (direct or wrapped in SPAN)
              let paragraphElement = null;
              if (node.tagName === 'P') {
                paragraphElement = node;
              } else if (node.tagName === 'SPAN' && node.children.length === 1 && node.firstElementChild.tagName === 'P') {
                paragraphElement = node.firstElementChild;
              }

              // Handle list blocks
              if (listContainer) {
                finalizeParagraph(contentBlocks);

                const listType = listContainer.tagName === 'UL' ? 'bulleted_list_item' : 'numbered_list_item';

                Array.from(listContainer.children).forEach(listItemNode => {
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
              if (paragraphElement) {
                finalizeParagraph(contentBlocks);

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
          });

          // Finalize any remaining content after processing all nodes
          finalizeParagraph(contentBlocks);
        }

        data.descriptionBlocks = contentBlocks.length > 0 ? contentBlocks : [{ type: 'paragraph', text: 'No description found.' }];

        // === Extract Contact Person ===

        const hiringTeamElement = document.querySelector('.hirer-card__hirer-information a');
        data.contactPerson = hiringTeamElement ? hiringTeamElement.textContent.trim() : '';
        data.contactPersonUrl = hiringTeamElement ? hiringTeamElement.href : '';

        return data;
      }
      return null;
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
