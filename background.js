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
 * @param {Object} jobData - The scraped job data
 * @param {Object} config - Notion configuration (token and database ID)
 * @returns {Promise<Object>} Notion API response
 */
async function saveJobToNotion(jobData, config) {
  const { notionToken, databaseId } = config;

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

  // Build Notion page with properties and content
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

    // Page content blocks
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{
            type: "text",
            text: { content: "About the job" }
          }]
        }
      },
      ...descriptionBlocks
    ]
  };

  // Add company logo as page icon if available
  if (jobData.companyLogo) {
    notionData.icon = {
      type: "external",
      external: { url: jobData.companyLogo }
    };
  }

  // Send request to Notion API
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

  return await response.json();
}