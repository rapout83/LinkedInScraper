// =============================================================================
// CONSTANTS
// =============================================================================

const SELECTORS = {
  SAVE_BUTTON: 'saveButton',
  SAVE_CONFIG: 'saveConfig',
  NOTION_TOKEN: 'notionToken',
  DATABASE_ID: 'databaseId',
  STATUS: 'status'
};

const STORAGE_KEYS = {
  NOTION_TOKEN: 'notionToken',
  DATABASE_ID: 'databaseId'
};

const STATUS_MESSAGES = {
  NAVIGATE_TO_LINKEDIN: 'Please navigate to a LinkedIn job posting page',
  FILL_BOTH_FIELDS: 'Please fill in both fields',
  CONFIG_SAVED: 'Configuration saved successfully!',
  CONFIGURE_CREDENTIALS: 'Please configure your Notion credentials first',
  SCRAPING: 'Scraping job data...',
  SAVING: 'Saving to Notion...',
  SUCCESS: 'Job saved to Notion successfully!',
  REFRESH_TAB: 'Error: Content script is not running. Please refresh the LinkedIn tab and try again.'
};

// =============================================================================
// INITIALIZATION
// =============================================================================

// Load saved configuration when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get([STORAGE_KEYS.NOTION_TOKEN, STORAGE_KEYS.DATABASE_ID]);

  if (config.notionToken) {
    document.getElementById(SELECTORS.NOTION_TOKEN).value = config.notionToken;
  }

  if (config.databaseId) {
    document.getElementById(SELECTORS.DATABASE_ID).value = config.databaseId;
  }

  // Check if we're on a LinkedIn job page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url.includes('linkedin.com/jobs/')) {
    showStatus(STATUS_MESSAGES.NAVIGATE_TO_LINKEDIN, 'info');
    document.getElementById(SELECTORS.SAVE_BUTTON).disabled = true;
  }
});

// =============================================================================
// CONFIGURATION MANAGEMENT
// =============================================================================

document.getElementById(SELECTORS.SAVE_CONFIG).addEventListener('click', async () => {
  const notionToken = document.getElementById(SELECTORS.NOTION_TOKEN).value.trim();
  const databaseId = document.getElementById(SELECTORS.DATABASE_ID).value.trim();

  if (!notionToken || !databaseId) {
    showStatus(STATUS_MESSAGES.FILL_BOTH_FIELDS, 'error');
    return;
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.NOTION_TOKEN]: notionToken,
    [STORAGE_KEYS.DATABASE_ID]: databaseId
  });

  showStatus(STATUS_MESSAGES.CONFIG_SAVED, 'success');
});

// =============================================================================
// JOB SAVING
// =============================================================================

document.getElementById(SELECTORS.SAVE_BUTTON).addEventListener('click', async () => {
  const config = await chrome.storage.sync.get([STORAGE_KEYS.NOTION_TOKEN, STORAGE_KEYS.DATABASE_ID]);

  if (!config.notionToken || !config.databaseId) {
    showStatus(STATUS_MESSAGES.CONFIGURE_CREDENTIALS, 'error');
    return;
  }

  showStatus(STATUS_MESSAGES.SCRAPING, 'info');
  document.getElementById(SELECTORS.SAVE_BUTTON).disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeJobData
    });

    const jobData = results[0].result;

    if (!jobData || !jobData.title) {
      throw new Error("Scraping failed: Data was null or empty");
    }

    showStatus(STATUS_MESSAGES.SAVING, 'info');

    chrome.runtime.sendMessage({
      action: 'saveToNotion',
      jobData: jobData,
      config: config
    }, (response) => {
      if (response.success) {
        showStatus(STATUS_MESSAGES.SUCCESS, 'success');
      } else {
        showStatus('Error: ' + response.error, 'error');
      }
      document.getElementById(SELECTORS.SAVE_BUTTON).disabled = false;
    });

  } catch (err) {
    if (err.message.includes('Receiving end does not exist')) {
      showStatus(STATUS_MESSAGES.REFRESH_TAB, 'error');
    } else {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    document.getElementById(SELECTORS.SAVE_BUTTON).disabled = false;
  }
});

// =============================================================================
// JOB DATA SCRAPING
// =============================================================================

// Function that will be injected into the page to scrape LinkedIn job data
function scrapeJobData() {
  // State variables for rich text processing
  let currentParagraphBuffer = [];
  let pendingSpace = false;
  const BREAK_MARKER = { type: 'BREAK' };

  // Filters out empty or invalid rich text items while preserving intentional spaces
  const cleanRichTextArray = (richTextArray) => {
    return richTextArray.filter(item => {
      if (!item || !item.text) return false;
      const content = item.text.content;
      return content.trim().length > 0 || content === ' ';
    });
  };

  // Converts the current buffer into a Notion paragraph block
  const finalizeParagraph = (blocksArray) => {
    const cleanedBuffer = cleanRichTextArray(currentParagraphBuffer);

    if (cleanedBuffer.length > 0) {
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

  // Extracts formatted rich text from a DOM node
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

        // Recursively process nested block elements as plain text
        if (child.tagName === 'P' || child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'LI') {
          const nestedContent = extractInlineRichText(child, isList);
          richTextArray.push(...nestedContent);
          return;
        }

        const nestedContent = extractInlineRichText(child, isList);
        const isBold = child.tagName === 'STRONG' || child.tagName === 'B';
        const isLink = child.tagName === 'A' && child.href;

        nestedContent.forEach(item => {
          if (item.type !== 'BREAK' && item.text) {
            if (isBold) {
              item.annotations = { ...item.annotations, bold: true };
            }
            if (isLink) {
              item.href = child.href;
            }
          }
        });
        richTextArray.push(...nestedContent);
      }
    });
    return richTextArray;
  };

  const extractListItemRichText = (node) => extractInlineRichText(node, true);

  return new Promise((resolve, reject) => {
    const KEY_ELEMENT_SELECTOR = 'h1.t-24';
    const MAX_WAIT_TIME_MS = 5000;
    let observer = null;

    const timeout = setTimeout(() => {
      if (observer) observer.disconnect();
      reject(new Error("Timeout: Job content did not load after 5 seconds."));
    }, MAX_WAIT_TIME_MS);

    const executeScraping = () => {
      const titleElement = document.querySelector(KEY_ELEMENT_SELECTOR);

      if (titleElement) {
        clearTimeout(timeout);
        if (observer) observer.disconnect();

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

        // Extract job ID from URL and construct canonical link
        const currentUrl = window.location.href;
        const jobIdRegex = /(\d{10})/;
        const match = currentUrl.match(jobIdRegex);
        const jobId = match ? match[1] : null;
        if (jobId) {
          data.url = `https://www.linkedin.com/jobs/view/${jobId}`;
        }

        // Extract company information
        const logoElement = document.querySelector('img.EntityPhoto-square-2, .job-details-jobs-unified-top-card__container--two-pane img.EntityPhoto-square-1');
        data.companyLogo = logoElement ? logoElement.src : '';

        const companyElement = document.querySelector('.job-details-jobs-unified-top-card__company-name a');
        data.company = companyElement ? companyElement.textContent.trim() : '';

        // Extract job details
        const titleElement = document.querySelector('h1.t-24');
        data.title = titleElement ? titleElement.textContent.trim() : '';

        const locationElement = document.querySelector('.job-details-jobs-unified-top-card__primary-description-container span.tvm__text');
        data.location = locationElement ? locationElement.textContent.trim() : '';

        // Extract work type and salary from preference bubbles
        const bubbles = document.querySelectorAll('.job-details-fit-level-preferences span.tvm__text');
        const workTypeKeywords = ['Remote', 'Hybrid', 'On-site'];
        const salaryRegex = /([£$€])\s*\d[\d,]*K/i;
        let workTypeFound = false;
        let salaryFound = false;

        for (const bubbleElement of bubbles) {
          const bubbleText = bubbleElement.textContent.trim();

          if (!workTypeFound) {
            for (const keyword of workTypeKeywords) {
              if (bubbleText.includes(keyword)) {
                data.workType = keyword;
                workTypeFound = true;
              }
            }
          }

          if (!salaryFound && salaryRegex.test(bubbleText)) {
            data.salary = bubbleText;
            salaryFound = true;
          }

          if (workTypeFound && salaryFound) break;
        }

        // Extract job description
        const descriptionContainer = document.querySelector('.jobs-description__content .mt4, .jobs-box__html-content .mt4');
        const contentBlocks = [];

        if (descriptionContainer) {
          const mainParagraph = descriptionContainer.querySelector('p[dir="ltr"]');
          const iterationRoot = mainParagraph || descriptionContainer;

          currentParagraphBuffer = [];
          pendingSpace = false;

          Array.from(iterationRoot.childNodes).forEach(node => {
            if (node.nodeType === 8) { // Skip Comment Nodes
              return;
            }

            if (node.nodeType === 3) { // Text Node
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

            } else if (node.nodeType === 1) { // Element Node

              if (pendingSpace && currentParagraphBuffer.length > 0) {
                currentParagraphBuffer.push({ text: { content: ' ' } });
                pendingSpace = false;
              }

              if (node.tagName === 'BR') {
                // A BR tag forces the current buffer to finalize as a paragraph
                finalizeParagraph(contentBlocks);
                pendingSpace = false;
                return;
              }

              const listContainer = node.tagName === 'UL' || node.tagName === 'OL' ? node : node.querySelector('ul, ol');

              // Check for paragraph element (direct or nested in SPAN)
              let paragraphElement = null;
              if (node.tagName === 'P') {
                paragraphElement = node;
              } else if (node.tagName === 'SPAN' && node.children.length === 1 && node.firstElementChild.tagName === 'P') {
                paragraphElement = node.firstElementChild;
              }

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

              if (paragraphElement) {
                finalizeParagraph(contentBlocks);

                const rawParagraphContent = extractInlineRichText(paragraphElement);
                const paragraphContent = cleanRichTextArray(rawParagraphContent);

                if (paragraphContent.length > 0) {
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

              // Handle inline elements with potential line breaks
              const nodeContent = extractInlineRichText(node);
              const breakIndex = nodeContent.findIndex(item => item.type === 'BREAK');

              if (breakIndex !== -1) {
                currentParagraphBuffer.push(...nodeContent.slice(0, breakIndex));
                finalizeParagraph(contentBlocks);
                const remainingContent = nodeContent.slice(breakIndex + 1);
                currentParagraphBuffer.push(...remainingContent);
                pendingSpace = false;
                return;
              }

              currentParagraphBuffer.push(...nodeContent);
            }
          });

          finalizeParagraph(contentBlocks);
        }
        data.descriptionBlocks = contentBlocks.length > 0 ? contentBlocks : [{ type: 'paragraph', text: 'No description found.' }];

        // Extract contact information
        const hiringTeamElement = document.querySelector('.hirer-card__hirer-information a');
        data.contactPerson = hiringTeamElement ? hiringTeamElement.textContent.trim() : '';
        data.contactPersonUrl = hiringTeamElement ? hiringTeamElement.href : '';

        return data;
      }
      return null;
    };

    // Check immediately, or wait for content to load
    const initialData = executeScraping();
    if (initialData) {
      return resolve(initialData);
    }

    observer = new MutationObserver(() => {
      const data = executeScraping();
      if (data) {
        resolve(data);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// =============================================================================
// UI UTILITIES
// =============================================================================

function showStatus(message, type) {
  const statusDiv = document.getElementById(SELECTORS.STATUS);
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;

  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}
