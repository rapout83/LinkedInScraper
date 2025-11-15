// Background service worker for handling Notion API calls

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveToNotion') {
    saveJobToNotion(request.jobData, request.config)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
});

async function saveJobToNotion(jobData, config) {
  const { notionToken, databaseId } = config;

  const descriptionBlocks = jobData.descriptionBlocks.flatMap(block => {
    // 1. DYNAMICALLY FIND rich_text: It's either at the top level (paragraph) 
    //    OR nested under the block's type key (list items).
    const blockTypeKey = block.type;
    const richTextContent = block.rich_text || (block[blockTypeKey] ? block[blockTypeKey].rich_text : null);

    if (richTextContent && richTextContent.length > 0) {
      let notionType = block.type;
      let blockKey = notionType;

      // 2. Re-construct the final Notion API compliant block
      return [{
        object: "block",
        type: notionType,
        [blockKey]: { rich_text: richTextContent }
      }];
    }

    return [];
  });

  // Prepare the Notion page properties
  const notionData = {
    parent: { database_id: databaseId },
    properties: {
      // Company - Rich Text
      "Company": {
        title: [
          {
            text: {
              content: jobData.company || ""
            }
          }
        ]
      },
      // Title property (usually called "Name" or "Title" in Notion)
      "Position": {
        rich_text: [
          {
            text: {
              content: jobData.title || "Untitled Job"
            }
          }
        ]
      },
      // Status
      "Status": {
        status: {
          name: "Not started"
        }
      },
      // Location - Rich Text
      "Location": {
        rich_text: [
          {
            text: {
              content: jobData.location || ""
            }
          }
        ]
      },
      // Work Type (Remote/Onsite/Hybrid) - Select
      "Work Type": {
        select: {
          name: jobData.workType || "On-site"
        }
      },
      // URL - URL property
      "URL": {
        url: jobData.url || null
      },
      // Contact Person - URL      
      "Contact": {
        url: jobData.contactPersonUrl || null
      },
      // Salary - Rich Text
      "Salary": {
        rich_text: [
          {
            text: {
              content: jobData.salary || ""
            }
          }
        ]
      }
    },

    // Add job description and company logo in the page content
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [
            {
              type: "text",
              text: {
                content: "About the job"
              }
            }
          ]
        }
      },
      ...descriptionBlocks // Spread the dynamically generated paragraph/list blocks
    ]
  };

  // Add company logo if available
  if (jobData.companyLogo) {
    notionData.icon = {
      type: "external",
      external: {
        url: jobData.companyLogo
      }
    };
  }

  // Make the API call to Notion
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

/**
 * Splits a long string into an array of Notion rich_text objects (for block content).
 * Preserves formatting by breaking at the nearest preceding whitespace.
 */
function chunkRichText(text) {
  if (!text) return [{ text: { content: '' } }];

  const MAX_CHAR_PER_CHUNK = 2000;
  const chunks = [];
  let remainingText = text;

  // (Use the robust, word-safe chunking logic from our previous successful iteration)
  while (remainingText.length > 0) {
    let chunk;
    if (remainingText.length <= MAX_CHAR_PER_CHUNK) {
      chunk = remainingText;
      remainingText = '';
    } else {
      let tempChunk = remainingText.substring(0, MAX_CHAR_PER_CHUNK);
      let safeBreakIndex = tempChunk.lastIndexOf(' ');
      if (safeBreakIndex === -1) safeBreakIndex = MAX_CHAR_PER_CHUNK;

      chunk = remainingText.substring(0, safeBreakIndex);
      remainingText = remainingText.substring(safeBreakIndex).trimStart();
    }

    chunks.push({
      text: { content: chunk }
    });
  }

  return chunks;
}

/**
 * Splits a long string into an array of Notion-compatible rich_text objects.
 * Prioritizes splitting by newlines and then chunks safely based on character limit.
 * @param {string} text The full job description string.
 * @returns {Array} An array of Notion rich_text objects.
 
function createRichTextBlocks(text) {
    if (!text) {
        return [];
    }

    const MAX_CHAR_PER_BLOCK = 2000;
    const blocks = [];
    let remainingText = text;

    while (remainingText.length > 0) {
        let chunk;

        // Step 1: Check if the remaining text is small enough for a single block
        if (remainingText.length <= MAX_CHAR_PER_BLOCK) {
            chunk = remainingText;
            remainingText = ''; // Done
        } 
        // Step 2: The remaining text must be chunked
        else {
            // Take the first 2000 characters
            let tempChunk = remainingText.substring(0, MAX_CHAR_PER_BLOCK);
            
            // Find the last safe place to break (the last whitespace character)
            let safeBreakIndex = tempChunk.lastIndexOf(' ');

            if (safeBreakIndex === -1) {
                // No whitespace found in the first 2000 chars (e.g., a single massive URL or word).
                // Force a split at the limit, as we must break the word.
                safeBreakIndex = MAX_CHAR_PER_BLOCK; 
            }

            chunk = remainingText.substring(0, safeBreakIndex);
            
            // Set the remaining text, trimming leading whitespace/newlines 
            // that may have been left after the split.
            remainingText = remainingText.substring(safeBreakIndex).trimStart();
        }

        // Add the chunk to the blocks array
        blocks.push({
            text: {
                content: chunk
            }
        });
    }

    return blocks;
}
    */