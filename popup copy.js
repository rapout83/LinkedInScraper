// Load saved configuration when popup opens
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

// Save configuration
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

// Save job to Notion
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
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeJobData
    });

    const jobData = results[0].result;

    /*
    // 1. Send message to content.js
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeJob' });
    */

    if (!jobData || !jobData.title) {
      throw new Error("Scraping failed: Data was null or empty");
      //showStatus('Could not extract job data. Make sure you\'re on a job posting page.', 'error');
      //document.getElementById('saveButton').disabled = false;
      //return;
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
    // 3. This catches the "Receiving end does not exist" error
    if (err.message.includes('Receiving end does not exist')) {
      showStatus('Error: Content script is not running. Please refresh the LinkedIn tab and try again.', 'error');
    } else {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    document.getElementById('saveButton').disabled = false;
  }
});

// Function that will be injected into the page to scrape data
function scrapeJobData() {
  // State Variables (Now scoped locally to be sent with the function)
  let currentParagraphBuffer = [];
  let pendingSpace = false; // CRITICAL: Flag to manage missing spaces
  const BREAK_MARKER = { type: 'BREAK' };

  const finalizeParagraph = (blocksArray) => {
    // Filter out all whitespace-only rich_text items from the buffer
    const cleanedBuffer = currentParagraphBuffer.filter(item => {
      if (!item.text) return false;

      const content = item.text.content;

      // 1. Keep if content has meaningful characters (trimmed length > 0)
      if (content.trim().length > 0) return true;

      // 2. Keep if content is EXACTLY the single space we inserted as a delimiter
      if (content === ' ') return true;

      return false;
    });

    if (cleanedBuffer.length > 0) {
      blocksArray.push({
        type: 'paragraph',
        rich_text: cleanedBuffer
      });
    }
    currentParagraphBuffer = [];
    pendingSpace = false; // Reset space after a break
  };

  const extractInlineRichText = (node) => {
    let richTextArray = [];

    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 3) { // Text Node
        const content = child.nodeValue;
        if (content && content.length > 0) {
          richTextArray.push({ text: { content: content } });
        }
      } else if (child.nodeType === 1) { // Element Node

        // Detect <BR> at any nested level
        if (child.tagName === 'BR') {
          richTextArray.push(BREAK_MARKER);
          return;
        }
        // Skip processing structural tags that shouldn't be recursed into (like lists)
        if (child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'LI') {
          return;
        }

        // Apply BOLD/LINK annotations recursively
        const nestedContent = extractInlineRichText(child);
        const isBold = child.tagName === 'STRONG' || child.tagName === 'B';
        const isLink = child.tagName === 'A' && child.href;

        nestedContent.forEach(item => {
          if (item.type !== 'BREAK') {
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

  // Function to process list items
  const extractListItemRichText = (node) => {
    // This uses the same logic as extractInlineRichText, but it's called on LI children
    let richTextArray = [];

    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 3) { // Text Node
        const content = child.nodeValue;
        if (content && content.length > 0) {
          richTextArray.push({ text: { content: content } });
        }
      } else if (child.nodeType === 1) { // Element Node

        // We only care about inline elements (bold, link, nested BR) inside an LI
        if (child.tagName === 'BR') {
          richTextArray.push(BREAK_MARKER); // Handle nested breaks inside an LI
          return;
        }
        // CRITICAL: Recursively process nested inline elements (e.g., <strong>)
        const nestedContent = extractListItemRichText(child);
        const isBold = child.tagName === 'STRONG' || child.tagName === 'B';
        const isLink = child.tagName === 'A' && child.href;

        nestedContent.forEach(item => {
          if (item.type !== 'BREAK') {
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
    // Filter out only the BREAK_MARKERs after processing everything
    return richTextArray.filter(item => item && item.text);
  };

  // Guarantees clean, Notion-compatible rich text arrays
  const cleanRichTextArray = (richTextArray) => {
    return richTextArray.filter(item => {
      // Only proceed if the item is a text object
      if (!item || !item.text) return false;

      const content = item.text.content;

      // 1. Keep if content has meaningful characters (trimmed length > 0)
      if (content.trim().length > 0) return true;

      // 2. Keep if content is EXACTLY the single space we inserted as a delimiter
      if (content === ' ') return true;

      return false;
    });
  };

  return new Promise((resolve, reject) => {
    const KEY_ELEMENT_SELECTOR = 'h1.t-24';
    const MAX_WAIT_TIME_MS = 5000;
    let observer = null;

    // Timeout logic...
    const timeout = setTimeout(() => {
      if (observer) observer.disconnect();
      reject(new Error("Timeout: Job content did not load after 10 seconds."));
    }, MAX_WAIT_TIME_MS);

    // Scraping logic (must contain all your selectors and return the data object)
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
        const currentUrl = window.location.href;

        // The RegEx searches the entire URL string for the first instance of 
        // exactly 10 consecutive digits (\d{10}).
        const jobIdRegex = /(\d{10})/;

        // .match() returns an array if found, where the first captured group (the digits) is at index 1.
        const match = currentUrl.match(jobIdRegex);
        const jobId = match ? match[1] : null;

        if (jobId) {
          // Construct the canonical, clean URL using the detected job ID
          // This format is the standard direct link for LinkedIn job postings.
          data.url = `https://www.linkedin.com/jobs/view/${jobId}`;
        }

        // Company Logo
        const logoElement = document.querySelector('img.EntityPhoto-square-2, .job-details-jobs-unified-top-card__container--two-pane img.EntityPhoto-square-1');
        data.companyLogo = logoElement ? logoElement.src : '';

        // Company Name
        const companyElement = document.querySelector('.job-details-jobs-unified-top-card__company-name a');
        data.company = companyElement ? companyElement.textContent.trim() : '';

        // Job Title
        const titleElement = document.querySelector('h1.t-24');
        data.title = titleElement ? titleElement.textContent.trim() : '';

        // Location
        const locationElement = document.querySelector('.job-details-jobs-unified-top-card__primary-description-container span.tvm__text');
        data.location = locationElement ? locationElement.textContent.trim() : '';

        // Bubbles 
        const bubbles = document.querySelectorAll('.job-details-fit-level-preferences span.tvm__text');
        // Define the patterns
        const workTypeKeywords = ['Remote', 'Hybrid', 'On-site'];
        // RegEx: Detects currency (£, $, €) + numbers (with optional comma) + 'K' (case insensitive)
        const salaryRegex = /([£$€])\s*\d[\d,]*K/i;

        // Use boolean flags to ensure we only scrape the first found instance
        let workTypeFound = false;
        let salaryFound = false;

        // Loop through all elements found
        for (const bubbleElement of bubbles) {
          const bubbleText = bubbleElement.textContent.trim();

          // --- 1. Check for Work Type ---
          if (!workTypeFound) {
            for (const keyword of workTypeKeywords) {
              if (bubbleText.includes(keyword)) {
                data.workType = keyword;
                workTypeFound = true;
              }
            }
          }

          // --- 2. Check for Salary Range ---
          if (!salaryFound) {
            // Use the regex test() method to see if the pattern exists in the text
            if (salaryRegex.test(bubbleText)) {
              data.salary = bubbleText; // Capture the entire bubble text as the salary string
              salaryFound = true;
            }
          }

          // Optional: Stop the loop once both pieces of data are secured
          if (workTypeFound && salaryFound) {
            break;
          }
        }

        // Job Description
        const descriptionContainer = document.querySelector('.jobs-description__content .mt4, .jobs-box__html-content .mt4');
        const contentBlocks = []; // Array to hold the structured output

        if (descriptionContainer) {
          // Crucial: Get the actual paragraph child that contains everything
          const mainParagraph = descriptionContainer.querySelector('p[dir="ltr"]');
          debugger;
          if (mainParagraph) {
            currentParagraphBuffer = [];
            pendingSpace = false; // Reset the flag before starting the loop

            Array.from(mainParagraph.childNodes).forEach(node => {

              if (node.nodeType === 8) { // Explicitly skip Comment Nodes
                return;
              }

              if (node.nodeType === 3) { // Text Node
                const text = node.nodeValue;

                // 1. Skip Text Nodes that are ONLY whitespace/newlines (The Glue)
                if (text && text.trim().length === 0) {
                  pendingSpace = true; // Use whitespace as a cue to add space later
                  return;
                }

                // 2. Insert space if one is pending
                if (pendingSpace && currentParagraphBuffer.length > 0) {
                  currentParagraphBuffer.push({ text: { content: ' ' } });
                }
                pendingSpace = false;

                // PUSH RAW CONTENT (We rely on finalizeParagraph to trim later)
                if (text && text.length > 0) {
                  currentParagraphBuffer.push({ text: { content: text } });
                }

              } else if (node.nodeType === 1) { // Element Node

                // 1: Handle direct sibling <BR> as a paragraph break
                if (node.tagName === 'BR') {
                  finalizeParagraph(contentBlocks); // Force a break
                  pendingSpace = false; // Reset state
                  return;
                }

                // Insert space before a new element if one is pending
                if (pendingSpace && currentParagraphBuffer.length > 0) {
                  currentParagraphBuffer.push({ text: { content: ' ' } });
                  pendingSpace = false;
                }
                /*
                                // Minimal List Check (Placeholder)
                                if (node.tagName === 'UL' || node.tagName === 'OL' || node.querySelector('ul, ol')) {
                                  finalizeParagraph(contentBlocks); // CALL WITH ARGUMENT
                                  contentBlocks.push({ type: 'list_item', rich_text: [{ text: { content: "LIST_PLACEHOLDER" } }] });
                                  pendingSpace = false; // Reset space after a structural break
                                  return;
                                }
                */

                // List handling logic
                // Check if this node is the container holding the list (UL/OL)
                const listElement = node.tagName === 'UL' || node.tagName === 'OL' ? node : node.querySelector('ul, ol');

                if (listElement) {
                  
                  finalizeParagraph(contentBlocks); // Finalize any preceding paragraph

                  // Now determine the type based on the nested listElement's tag name
                  const listType = listElement.tagName === 'UL' ? 'bulleted_list_item' : 'numbered_list_item';

                  Array.from(listElement.children).forEach(listItemNode => {
                    // Ensure we are only processing direct list item children
                    if (listItemNode.tagName === 'LI') {
                      // Extract and then CLEAN the content using the proven filter
                      const rawListItemContent = extractListItemRichText(listItemNode);
                      const listItemContent = cleanRichTextArray(rawListItemContent);
                      
                      if (listItemContent.length > 0) {
                        contentBlocks.push({
                          type: listType,
                          [listType]: {
                            rich_text: listItemContent
                          }
                        });
                      }
                    }
                  });
                  pendingSpace = false; // Reset state after a large block element
                  return;
                }

                // Process all other elements
                const nodeContent = extractInlineRichText(node);

                // Use the RAW nodeContent for index calculation (No extra filtering)
                const breakIndex = nodeContent.findIndex(item => item.type === 'BREAK');

                if (breakIndex !== -1) {
                  // 1. Push content BEFORE the break
                  currentParagraphBuffer.push(...nodeContent.slice(0, breakIndex));

                  // 2. Finalize the paragraph (THE BREAK)
                  finalizeParagraph(contentBlocks); // CALL WITH ARGUMENT

                  // 3. Start a new paragraph buffer with the remaining content
                  const remainingContent = nodeContent.slice(breakIndex + 1);
                  currentParagraphBuffer.push(...remainingContent);

                  pendingSpace = false; // Critical reset after a forced break
                  return;
                }

                // If no break, push content and set flag for space
                currentParagraphBuffer.push(...nodeContent);
                //pendingSpace = true; // Assume a space is needed after this inline element
              }
            });

            finalizeParagraph(contentBlocks); // FINAL CALL WITH ARGUMENT
          }
        }

        // Ensure jobData holds the structured array now:
        data.descriptionBlocks = contentBlocks.length > 0 ? contentBlocks : [{ type: 'paragraph', text: 'No description found.' }];

        // Contact Person
        const hiringTeamElement = document.querySelector('.hirer-card__hirer-information a');
        data.contactPerson = hiringTeamElement ? hiringTeamElement.textContent.trim() : '';
        data.contactPersonUrl = hiringTeamElement ? hiringTeamElement.href : '';

        return data;
      }
      return null;
    };

    // Initial check and observer setup...
    const initialData = executeScraping();
    if (initialData) {
      return resolve(initialData);
    }

    observer = new MutationObserver((mutationsList, obs) => {
      const data = executeScraping();
      if (data) {
        resolve(data);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

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
