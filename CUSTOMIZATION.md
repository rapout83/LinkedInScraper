# Customization Guide

Want to modify the extension for your specific needs? Here's how!

---

## 🎨 1. Change the Look & Feel

### Update Colors
Edit `popup.html`, find the `<style>` section:

```css
/* Change primary color (LinkedIn blue by default) */
h2 {
  color: #0a66c2;  /* ← Change this */
}

button {
  background-color: #0a66c2;  /* ← And this */
}
```

### Change Extension Icons
Replace the icon files in `/icons/` with your own PNG files:
- `icon16.png` (16x16px)
- `icon48.png` (48x48px)  
- `icon128.png` (128x128px)

Then reload the extension.

---

## 📊 2. Add More Fields to Scrape

### Step 1: Update the Scraper (content.js)

Add new scraping logic in the `scrapeLinkedInJob()` function:

```javascript
// Example: Add salary information
const salaryElement = document.querySelector('.job-details-jobs-unified-top-card__job-insight');
data.salary = salaryElement ? salaryElement.textContent.trim() : '';

// Example: Add seniority level
const levelElement = document.querySelector('.job-details-jobs-unified-top-card__job-insight span');
data.seniorityLevel = levelElement ? levelElement.textContent.trim() : '';

// Example: Add posted date
const dateElement = document.querySelector('.jobs-unified-top-card__posted-date');
data.postedDate = dateElement ? dateElement.textContent.trim() : '';
```

### Step 2: Add to Notion Database
Open your Notion database and add new columns:
- Salary (Text or Number)
- Seniority Level (Select)
- Posted Date (Date or Text)

### Step 3: Update Notion API Call (background.js)

Add the new properties in the `saveJobToNotion()` function:

```javascript
properties: {
  // ... existing properties ...
  
  "Salary": {
    rich_text: [
      {
        text: {
          content: jobData.salary || ""
        }
      }
    ]
  },
  "Seniority Level": {
    select: {
      name: jobData.seniorityLevel || "Not specified"
    }
  },
  "Posted Date": {
    rich_text: [
      {
        text: {
          content: jobData.postedDate || ""
        }
      }
    ]
  }
}
```

---

## 🎯 3. Change Which Pages Activate the Extension

Edit `manifest.json`:

```json
"content_scripts": [
  {
    "matches": [
      "https://www.linkedin.com/jobs/*",
      "https://www.linkedin.com/jobs/collections/*",
      "https://www.linkedin.com/jobs/search/*"  // Add more patterns
    ],
    "js": ["content.js"]
  }
]
```

---

## 🔔 4. Add Notifications

### Browser Notification on Success

Add to `popup.js` after successful save:

```javascript
chrome.notifications.create({
  type: 'basic',
  iconUrl: 'icons/icon48.png',
  title: 'Job Saved!',
  message: `"${jobData.title}" saved to Notion`,
  priority: 2
});
```

Don't forget to add permission in `manifest.json`:
```json
"permissions": [
  "activeTab",
  "storage",
  "notifications"  // ← Add this
]
```

---

## 🤖 5. Add Auto-Save Feature

Make it save automatically when you visit a job page:

### Update content.js:

```javascript
// Add at the end of content.js
(async function autoSave() {
  // Check if auto-save is enabled
  const settings = await chrome.storage.sync.get(['autoSave']);
  
  if (settings.autoSave) {
    // Wait 2 seconds for page to load
    setTimeout(async () => {
      const jobData = scrapeLinkedInJob();
      const config = await chrome.storage.sync.get(['notionToken', 'databaseId']);
      
      if (config.notionToken && config.databaseId && jobData.title) {
        chrome.runtime.sendMessage({
          action: 'saveToNotion',
          jobData: jobData,
          config: config
        });
      }
    }, 2000);
  }
})();
```

### Add toggle in popup.html:

```html
<label>
  <input type="checkbox" id="autoSave"> Auto-save jobs when visiting page
</label>
```

---

## 📁 6. Add Multiple Database Support

Save different job types to different databases:

### Update popup.html:
```html
<label for="databaseType">Database Type:</label>
<select id="databaseType">
  <option value="engineering">Engineering Jobs</option>
  <option value="design">Design Jobs</option>
  <option value="pm">Product Management</option>
</select>
```

### Update popup.js:
```javascript
// Save multiple database IDs
const config = {
  notionToken: token,
  databases: {
    engineering: 'database-id-1',
    design: 'database-id-2',
    pm: 'database-id-3'
  }
};
```

---

## 🏷️ 7. Add Tags/Categories

### Auto-tag based on job title:

```javascript
// In background.js, add logic to determine tags
function getTags(jobTitle) {
  const tags = [];
  const title = jobTitle.toLowerCase();
  
  if (title.includes('senior') || title.includes('lead')) {
    tags.push('Senior');
  }
  if (title.includes('junior') || title.includes('entry')) {
    tags.push('Entry-Level');
  }
  if (title.includes('manager') || title.includes('director')) {
    tags.push('Management');
  }
  
  return tags;
}

// Add to Notion properties:
"Tags": {
  multi_select: getTags(jobData.title).map(tag => ({ name: tag }))
}
```

Make sure your Notion database has a "Tags" property of type Multi-select.

---

## 🔍 8. Add Duplicate Detection

Prevent saving the same job twice:

### Add to popup.js before saving:

```javascript
// Check if URL already exists in saved jobs
const savedJobs = await chrome.storage.local.get('savedJobUrls') || { savedJobUrls: [] };

if (savedJobs.savedJobUrls.includes(jobData.url)) {
  showStatus('This job has already been saved!', 'info');
  return;
}

// After successful save, add URL to list
savedJobs.savedJobUrls.push(jobData.url);
await chrome.storage.local.set({ savedJobUrls: savedJobs.savedJobUrls });
```

---

## 📊 9. Add Statistics Tracking

Track how many jobs you've saved:

### Add to popup.html:
```html
<div class="stats">
  <p>Jobs saved today: <strong id="todayCount">0</strong></p>
  <p>Total jobs saved: <strong id="totalCount">0</strong></p>
</div>
```

### Add to popup.js:
```javascript
async function updateStats() {
  const stats = await chrome.storage.local.get(['todayCount', 'totalCount', 'lastDate']);
  const today = new Date().toDateString();
  
  // Reset daily count if it's a new day
  if (stats.lastDate !== today) {
    stats.todayCount = 0;
    stats.lastDate = today;
  }
  
  document.getElementById('todayCount').textContent = stats.todayCount || 0;
  document.getElementById('totalCount').textContent = stats.totalCount || 0;
}

// Call after saving
async function incrementStats() {
  const stats = await chrome.storage.local.get(['todayCount', 'totalCount']);
  await chrome.storage.local.set({
    todayCount: (stats.todayCount || 0) + 1,
    totalCount: (stats.totalCount || 0) + 1
  });
  updateStats();
}
```

---

## 🌐 10. Support Other Job Sites

Want to scrape from Indeed, Glassdoor, or other sites?

### Update manifest.json:
```json
"content_scripts": [
  {
    "matches": [
      "https://www.linkedin.com/jobs/*",
      "https://www.indeed.com/viewjob*",
      "https://www.glassdoor.com/Job/*"
    ],
    "js": ["content.js"]
  }
]
```

### Add site detection in content.js:
```javascript
function scrapeJobData() {
  const url = window.location.href;
  
  if (url.includes('linkedin.com')) {
    return scrapeLinkedIn();
  } else if (url.includes('indeed.com')) {
    return scrapeIndeed();
  } else if (url.includes('glassdoor.com')) {
    return scrapeGlassdoor();
  }
}

function scrapeLinkedIn() {
  // Current LinkedIn scraping logic
}

function scrapeIndeed() {
  // Add Indeed-specific selectors
}

function scrapeGlassdoor() {
  // Add Glassdoor-specific selectors
}
```

---

## 🔄 After Making Changes

1. Save your files
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Test your changes!

---

## 💡 Ideas for Advanced Features

- **Bulk save**: Select multiple jobs from search results
- **Apply tracking**: Track when you applied, follow-ups, etc.
- **Job alerts**: Get notified when new jobs match your criteria
- **Export**: Export jobs to CSV, PDF, or email
- **AI integration**: Use Claude API to analyze job descriptions
- **Interview prep**: Auto-generate interview questions based on job description
- **Salary insights**: Fetch salary data from external APIs
- **Application templates**: Generate cover letters based on job description

---

Have fun customizing! 🚀
