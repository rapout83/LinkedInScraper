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
    console.log('[LinkedIn Scraper] About to execute script on tab:', tab.id);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: scrapeJobData,
      args: [tab.url]
    });

    // When allFrames: true, results contains data from all frames
    // Find the frame that has valid job data (title exists)
    console.log('[LinkedIn Scraper] Results from all frames:', results.length);
    console.log('[LinkedIn Scraper] All results:', results.map((r, i) => ({
      frameId: i,
      hasResult: !!r.result,
      hasTitle: !!r.result?.title,
      title: r.result?.title?.substring(0, 50),
      blockCount: r.result?.descriptionBlocks?.length
    })));

    const jobData = results.find(r => r.result && r.result.title)?.result;

    // Debug logging
    console.log('[LinkedIn Scraper] Selected job data:', {
      title: jobData?.title,
      company: jobData?.company,
      location: jobData?.location,
      descriptionBlockCount: jobData?.descriptionBlocks?.length,
      blockTypes: jobData?.descriptionBlocks?.map(b => b.type).slice(0, 20)
    });

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
   * Finds the job description content starting from "About the job" heading.
   * Returns an object with { container, startElement } to process only relevant content.
   */
  const findDescriptionContainer = () => {
    // Look for "About the job" heading
    const aboutJobHeadings = Array.from(document.querySelectorAll('h2, h3, h4, div, span, strong')).filter(el => {
      const text = el.textContent?.trim();
      return text === 'About the job' && el.children.length === 0; // Leaf node
    });

    if (aboutJobHeadings.length > 0) {
      const heading = aboutJobHeadings[0];

      // Find a reasonable parent container (not too far up)
      let container = heading.parentElement;
      let depth = 0;
      const maxDepth = 5;

      while (container && depth < maxDepth && container !== document.body) {
        const textLength = container.innerText?.length || 0;

        // Stop if we find a container that seems reasonable for a job description
        // Not too small (<300 chars) and not too large (>15000 chars)
        if (textLength > 300 && textLength < 15000) {
          return { container, startElement: heading };
        }

        container = container.parentElement;
        depth++;
      }

      // If we couldn't find a perfect container, use the heading's parent
      return { container: heading.parentElement || heading, startElement: heading };
    }

    // Fallback: try to find any substantial content container
    const main = document.querySelector('main');
    if (main) {
      const article = main.querySelector('article');
      if (article) {
        return { container: article, startElement: null };
      }

      return { container: main, startElement: null };
    }

    return { container: document.body, startElement: null };
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
      const { container: descriptionContainer, startElement } = findDescriptionContainer();
      const contentBlocks = [];

      // Debug logging
      console.log('[Scraper] Description container:', descriptionContainer?.tagName, descriptionContainer?.className);
      console.log('[Scraper] Start element:', startElement?.tagName, startElement?.textContent?.substring(0, 50));
      console.log('[Scraper] Container text length:', descriptionContainer?.innerText?.length);

      if (descriptionContainer) {
        currentParagraphBuffer = [];
        pendingSpace = false;
        let foundStart = !startElement; // If no startElement, start processing immediately
        let skipFirstText = false; // Flag to skip "About the job" if it appears as text

        // Recursive function to process DOM nodes
        const processNode = (node) => {
          // Check if this is the start element
          if (startElement && !foundStart && node === startElement) {
            foundStart = true;
            skipFirstText = true; // Skip any immediate text that might duplicate the heading
            return; // Skip the heading itself
          }

          // Skip comment nodes
          if (node.nodeType === 8) return;

          // If we haven't found the start yet, only recurse into containers to look for it
          if (!foundStart) {
            if (node.nodeType === 1) {
              console.log('[Scraper] Looking for start element, checking:', node.tagName);
              const isContainer = ['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'SPAN'].includes(node.tagName);
              if (isContainer) {
                console.log('[Scraper] Recursing into container to find start');
                Array.from(node.childNodes).forEach(processNode);
                // After recursing, check if we found the start element
                // If so, don't return - continue processing this node normally
                if (foundStart) {
                  console.log('[Scraper] Start found during recursion, continuing to process this container');
                  // Don't return, fall through to process this container's content
                } else {
                  return;
                }
              } else {
                return;
              }
            } else {
              return;
            }
          }

          // Stop processing if we hit certain sections that indicate end of job description
          if (node.nodeType === 1) {
            const textContent = node.textContent?.trim() || '';
            const stopPhrases = [
              'Set alert for similar jobs',
              'See how you compare',
              'Exclusive Job Seeker Insights',
              'About the company',
              'Looking for talent?',
              'Questions?',
              'LinkedIn Corporation'
            ];

            if (stopPhrases.some(phrase => textContent.startsWith(phrase))) {
              return; // Stop processing this branch
            }
          }

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
              // Skip if this BR was already processed as part of list spacing
              if (node._listBRProcessed) {
                return;
              }

              console.log('[Scraper] Found BR tag, checking for double BR');
              // Check if next sibling is also BR (or whitespace then BR) = paragraph break
              // Single BR = just a line break within content (treat as space)
              let nextNode = node.nextSibling;

              // Skip whitespace text nodes
              while (nextNode && nextNode.nodeType === 3 && nextNode.nodeValue.trim().length === 0) {
                nextNode = nextNode.nextSibling;
              }

              // If next node is also a BR, this is a paragraph break
              if (nextNode && nextNode.nodeType === 1 && nextNode.tagName === 'BR') {
                console.log('[Scraper] Double BR detected - finalizing paragraph');
                finalizeParagraph(contentBlocks);
                pendingSpace = false;
                // Mark both BRs as processed
                nextNode._listBRProcessed = true;
                return;
              } else {
                // Single BR - treat as a space or soft line break
                if (currentParagraphBuffer.length > 0) {
                  currentParagraphBuffer.push({ text: { content: ' ' } });
                }
                pendingSpace = false;
                return;
              }
            }

            // Check if this is a container element that should be recursively traversed
            // SPAN can act as a container when it has block-level children (BR, UL, etc.)
            const isContainer = ['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'SPAN'].includes(node.tagName);

            if (isContainer) {
              console.log('[Scraper] Processing container:', node.tagName, 'with', node.childNodes.length, 'children, foundStart=', foundStart);
              // Don't finalize paragraphs here - let BR tags and block elements handle it
              // Just recursively process children of container elements
              Array.from(node.childNodes).forEach(processNode);
              return;
            }

            // Check if this is a list element
            const isList = node.tagName === 'UL' || node.tagName === 'OL';

            // Check if this is a paragraph element
            // But if P contains block-level children (UL, OL), treat it as a container instead
            let isParagraph = false;
            if (node.tagName === 'P') {
              // Check if P contains block-level children
              const hasBlockChildren = node.querySelector('ul, ol, br');
              if (hasBlockChildren) {
                // Treat as container, not paragraph
                console.log('[Scraper] P element contains block children, treating as container');
                Array.from(node.childNodes).forEach(processNode);
                return;
              }
              isParagraph = true;
            } else if (node.tagName === 'SPAN' && node.children.length === 1 && node.firstElementChild.tagName === 'P') {
              isParagraph = true;
            }

            // Handle list blocks
            if (isList) {
              console.log('[Scraper] Found list:', node.tagName, 'with', node.children.length, 'items');
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

              // Skip the BR tags immediately after UL (they're just spacing)
              let nextSibling = node.nextSibling;
              while (nextSibling && nextSibling.nodeType === 3 && nextSibling.nodeValue.trim().length === 0) {
                nextSibling = nextSibling.nextSibling;
              }
              // If next is BR or double BR, skip them (they were handled by the list)
              if (nextSibling && nextSibling.nodeType === 1 && nextSibling.tagName === 'BR') {
                // Mark this BR as processed by setting a flag
                nextSibling._listBRProcessed = true;
              }

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

            // Check if this is an inline formatting element (STRONG, EM, A, etc.)
            const isInlineFormat = ['STRONG', 'B', 'EM', 'I', 'A', 'CODE'].includes(node.tagName);

            if (isInlineFormat) {
              console.log('[Scraper] Processing inline element:', node.tagName);
              // Extract rich text with formatting
              const nodeContent = extractInlineRichText(node);
              console.log('[Scraper] Inline content:', nodeContent.length, 'items, first:', nodeContent[0]?.text?.content?.substring(0, 30));

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
              return;
            }

            // For any other element type, treat as inline and extract text
            console.log('[Scraper] Unknown element type:', node.tagName, '- extracting as inline');
            const nodeContent = extractInlineRichText(node);
            currentParagraphBuffer.push(...nodeContent);
          }
        };

        // Start processing from the description container
        Array.from(descriptionContainer.childNodes).forEach(processNode);

        // Finalize any remaining content
        finalizeParagraph(contentBlocks);

        console.log('[Scraper] Total blocks created:', contentBlocks.length);
        console.log('[Scraper] Block types:', contentBlocks.map(b => b.type).join(', '));
      }

      data.descriptionBlocks = contentBlocks.length > 0 ? contentBlocks : [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: 'No description found.' } }]
        }
      }];

      // === Extract Contact Person ===
      // Look for "Meet the hiring team" section
      let contactLink = null;

      // Find any element containing "Meet the hiring team" text
      const allElements = Array.from(document.querySelectorAll('*'));
      const hiringTeamElement = allElements.find(el => {
        const text = el.textContent?.trim() || '';
        const ownText = el.innerText?.trim() || '';
        // Check if this element itself (not children) contains the text
        return (text === 'Meet the hiring team' || ownText === 'Meet the hiring team') &&
               el.children.length === 0;
      });

      if (hiringTeamElement) {
        // Walk forward through the DOM to find the first profile link after this element
        let walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: function(node) {
              // Skip nodes before hiringTeamElement
              if (node === hiringTeamElement) {
                return NodeFilter.FILTER_SKIP;
              }
              const position = node.compareDocumentPosition(hiringTeamElement);
              if (position & Node.DOCUMENT_POSITION_FOLLOWING ||
                  position & Node.DOCUMENT_POSITION_CONTAINED_BY) {
                // This node is before hiringTeamElement
                return NodeFilter.FILTER_SKIP;
              }
              // This node is after hiringTeamElement
              if (node.tagName === 'A' && node.href && node.href.includes('/in/')) {
                return NodeFilter.FILTER_ACCEPT;
              }
              return NodeFilter.FILTER_SKIP;
            }
          }
        );

        contactLink = walker.nextNode();
      }

      // Fallback: Look for profile links, excluding navigation and "People you can reach out to"
      if (!contactLink) {
        const allProfileLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));

        for (const link of allProfileLinks) {
          // Skip navigation links
          if (link.closest('nav, header')) continue;

          // Check if under "People you can reach out to"
          let isInReachOut = false;
          let elem = link.parentElement;
          while (elem && elem !== document.body) {
            const text = elem.textContent || '';
            if (text.includes('People you can reach out to')) {
              // Check if there's a heading with this exact text as an ancestor
              const headings = elem.querySelectorAll('h1, h2, h3, h4, h5, h6');
              for (const heading of headings) {
                if (heading.textContent?.trim() === 'People you can reach out to') {
                  isInReachOut = true;
                  break;
                }
              }
              if (isInReachOut) break;
            }
            elem = elem.parentElement;
          }

          if (!isInReachOut) {
            contactLink = link;
            break;
          }
        }
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
