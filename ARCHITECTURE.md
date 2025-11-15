# Extension Architecture & Flow

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    LinkedIn Job Page                         │
│  (User views job posting on linkedin.com/jobs/view/...)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ User clicks extension icon
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Extension Popup                         │
│  • Shows configuration form (first time)                     │
│  • Shows "Save Job to Notion" button                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ User clicks "Save Job"
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    popup.js (Main Logic)                     │
│  1. Retrieves saved config (Notion token + DB ID)           │
│  2. Injects scraping function into LinkedIn page            │
│  3. Collects scraped data                                   │
│  4. Sends to background.js for API call                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              content.js (Scraping Logic)                     │
│  • Extracts job title                                       │
│  • Extracts company name & logo                             │
│  • Extracts location & work type                            │
│  • Extracts job description                                 │
│  • Extracts contact person                                  │
│  • Returns all data as JSON object                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           background.js (Notion API Handler)                 │
│  1. Formats data for Notion API                             │
│  2. Makes POST request to Notion API                        │
│  3. Handles response/errors                                 │
│  4. Returns success/failure to popup                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ API Request
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Notion API (api.notion.com)               │
│  • Creates new page in database                             │
│  • Populates all properties                                 │
│  • Returns success response                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Your Notion Database                        │
│  ✅ New job entry appears with all details!                 │
└─────────────────────────────────────────────────────────────┘
```

## File Responsibilities

### manifest.json
- Defines extension metadata
- Declares permissions needed
- Specifies which scripts run where

### popup.html + popup.js
- User interface
- Configuration management
- Orchestrates the scraping and saving process

### content.js
- Injected into LinkedIn pages
- Scrapes job data from DOM
- Returns structured data

### background.js
- Runs in the background (service worker)
- Handles Notion API calls
- Cannot access DOM, only APIs

## Data Flow

1. **User Input** → Extension popup
2. **Configuration** → Chrome Storage (encrypted)
3. **Scraping** → LinkedIn DOM → Structured JSON
4. **API Call** → Background script → Notion API
5. **Result** → Notion Database

## Security Features

- Credentials stored in Chrome's secure storage
- Direct browser-to-Notion communication (no middleman)
- No data logging or tracking
- Permissions limited to only what's needed

## Customization Points

Want to modify the extension? Here's where to make changes:

- **Add new fields**: Update selectors in `content.js` and properties in `background.js`
- **Change UI**: Edit `popup.html` and styles
- **Modify database structure**: Update the properties object in `background.js`
- **Add validation**: Enhance logic in `popup.js`
