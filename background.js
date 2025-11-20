// ============================================================================
// BACKGROUND SERVICE WORKER
// Handles Notion API calls for saving LinkedIn job data
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveToNotion') {
    saveJobToNotion(request.jobData, request.config)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});

// ============================================================================
// NOTION API INTEGRATION
// ============================================================================

/**
 * Saves job data to a Notion database.
 * Handles the 100-block limit by batching content across multiple API calls.
 * @param {Object} jobData - The scraped job data
 * @param {Object} config - Notion configuration (token and database ID)
 * @returns {Promise<Object>} Notion API response
 */
async function saveJobToNotion(jobData, config) {
  const { notionToken, databaseId } = config;
  const MAX_BLOCKS_PER_REQUEST = 100;

  // Transform scraped description blocks into Notion-compatible format
  const descriptionBlocks = jobData.descriptionBlocks.flatMap(block => {
    const blockTypeKey = block.type;
    const richTextContent = block.rich_text || block[blockTypeKey]?.rich_text;

    if (richTextContent && richTextContent.length > 0) {
      return [{
        object: "block",
        type: block.type,
        [block.type]: { rich_text: richTextContent }
      }];
    }

    return [];
  });

  // Create heading block
  const headingBlock = {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{
        type: "text",
        text: { content: "About the job" }
      }]
    }
  };

  // Calculate how many description blocks can fit in initial request
  // (Reserve 1 slot for heading)
  const maxInitialDescriptionBlocks = MAX_BLOCKS_PER_REQUEST - 1;
  const initialBlocks = descriptionBlocks.slice(0, maxInitialDescriptionBlocks);
  const remainingBlocks = descriptionBlocks.slice(maxInitialDescriptionBlocks);

  // Build Notion page with properties and initial content
  const notionData = {
    parent: { database_id: databaseId },
    properties: {
      "Company": {
        title: [{
          text: { content: jobData.company || "" }
        }]
      },
      "Position": {
        rich_text: [{
          text: { content: jobData.title || "Untitled Job" }
        }]
      },
      "Status": {
        status: { name: "Not started" }
      },
      "Location": {
        rich_text: [{
          text: { content: jobData.location || "" }
        }]
      },
      "Work Type": {
        select: { name: jobData.workType || "On-site" }
      },
      "URL": {
        url: jobData.url || null
      },
      "Contact": {
        url: jobData.contactPersonUrl || null
      },
      "Salary": {
        rich_text: [{
          text: { content: jobData.salary || "" }
        }]
      }
    },
    children: [headingBlock, ...initialBlocks]
  };

  // Add company logo as page icon if available
  if (jobData.companyLogo) {
    notionData.icon = {
      type: "external",
      external: { url: jobData.companyLogo }
    };
  }

  // Create the page with initial blocks
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify(notionData)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to save to Notion');
  }

  const pageData = await response.json();

  // If there are remaining blocks, append them in batches
  if (remainingBlocks.length > 0) {
    await appendBlocksInBatches(pageData.id, remainingBlocks, notionToken);
  }

  return pageData;
}

/**
 * Appends blocks to a Notion page in batches of 100.
 * Includes rate limiting to respect Notion's API limits (3 requests/second).
 * @param {string} pageId - The Notion page ID
 * @param {Array} blocks - Array of blocks to append
 * @param {string} notionToken - Notion API token
 */
async function appendBlocksInBatches(pageId, blocks, notionToken) {
  const BATCH_SIZE = 100;
  const RATE_LIMIT_DELAY = 350; // ms between requests (slightly under 3 req/sec)

  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);

    // Add delay between batches to respect rate limits (skip for first batch)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }

    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ children: batch })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to append blocks (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${errorData.message || 'Unknown error'}`);
    }
  }
}