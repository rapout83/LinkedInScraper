// This content script runs on LinkedIn job pages
// It's mostly used for any page-specific functionality if needed

console.log('LinkedIn to Notion extension loaded');

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJob') {
    scrapeLinkedInJob()
      .then(data => sendResponse({ success: true, data: data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    // Returning true is essential to keep the message channel open for the Promise to resolve
    return true;
  }  
});

// --- Mutation Observer Scraping Function ---
function scrapeLinkedInJob() {
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
        const descriptionElement = document.querySelector('.jobs-description__content, .jobs-box__html-content');
        data.description = descriptionElement ? descriptionElement.textContent.trim() : '';
        
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
