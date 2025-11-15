# LinkedIn to Notion Job Saver

A Chrome extension that allows you to save LinkedIn job postings directly to your Notion database with a single click.

## Features

- 🎯 One-click save from any LinkedIn job posting
- 📊 Captures comprehensive job data:
  - Job Title
  - Company Name
  - Company Logo
  - Location
  - Work Type (Remote/Hybrid/On-site)
  - Job Description
  - Contact Person Details
  - Job URL
- 🔒 Secure credential storage
- 🎨 Clean, modern interface

## Prerequisites

Before using this extension, you need:

1. **A Notion account** (free or paid)
2. **A Notion integration** with access to your database
3. **A Notion database** set up to receive job data

## Setup Instructions

### Step 1: Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Give it a name (e.g., "LinkedIn Job Saver")
4. Select the workspace where your database is located
5. Click **"Submit"**
6. Copy the **"Integration Token"** (starts with `secret_...`) - you'll need this later

### Step 2: Create a Notion Database

1. Create a new page in Notion
2. Add a database (Table view recommended)
3. Create the following properties (columns):
   - **Name** (Title) - automatically created
   - **Company** (Text)
   - **Location** (Text)
   - **Work Type** (Select) - Add options: Remote, Hybrid, On-site
   - **URL** (URL)
   - **Contact Person** (Text)

4. Click the **"..."** menu in the top right of your database
5. Scroll down and click **"+ Add connections"**
6. Select your integration from Step 1

### Step 3: Get Your Database ID

Your database ID is in the URL when you open the database:
```
https://www.notion.so/[workspace]/[DATABASE_ID]?v=[view_id]
```

The DATABASE_ID is the 32-character string (with dashes) between your workspace name and the `?v=`

Example:
```
https://www.notion.so/myworkspace/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6?v=...
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                  This is your Database ID
```

### Step 4: Install the Chrome Extension

1. Download/clone this extension folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in top right)
4. Click **"Load unpacked"**
5. Select the `linkedin-notion-extension` folder
6. The extension icon should now appear in your Chrome toolbar

### Step 5: Configure the Extension

1. Click the extension icon in your Chrome toolbar
2. Enter your **Notion Integration Token** (from Step 1)
3. Enter your **Database ID** (from Step 3)
4. Click **"Save Configuration"**

You only need to do this once - your credentials are saved securely in Chrome.

## How to Use

1. Navigate to any LinkedIn job posting page
   - Example: `https://www.linkedin.com/jobs/view/123456789/`

2. Click the extension icon in your Chrome toolbar

3. Click the **"Save Job to Notion"** button

4. Wait for the success message!

5. Check your Notion database - the job should now be there with all details

## Database Schema

The extension expects your Notion database to have these properties:

| Property Name | Type | Description |
|--------------|------|-------------|
| Name | Title | Job title (required by Notion) |
| Company | Text | Company name |
| Location | Text | Job location |
| Work Type | Select | Remote/Hybrid/On-site |
| URL | URL | Link to the job posting |
| Contact Person | Text | Hiring manager or recruiter name |

The job description and company logo are added to the page content.

## Troubleshooting

### "Could not extract job data"
- Make sure you're on an actual job posting page (URL should contain `/jobs/view/`)
- Try refreshing the page and clicking the button again
- LinkedIn may have changed their page structure - you might need to update the selectors

### "Failed to save to Notion"
- Verify your Integration Token is correct
- Verify your Database ID is correct
- Make sure you've connected the integration to your database (Step 2.6)
- Ensure all required properties exist in your database

### Extension icon is grayed out
- Make sure you're on a LinkedIn page
- The extension only activates on `linkedin.com/jobs/*` pages

## Updating the Extension

If you make changes to the code:
1. Go to `chrome://extensions/`
2. Click the refresh icon on the extension card
3. Test your changes

## Technical Details

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Permissions**: 
  - `activeTab` - to access the current LinkedIn page
  - `storage` - to save your Notion credentials
- **APIs Used**:
  - Notion API v2022-06-28
  - Chrome Extension APIs (scripting, storage, runtime)

## Privacy & Security

- Your Notion credentials are stored locally in Chrome's secure storage
- No data is sent to any third-party servers except Notion
- All communication with Notion is done directly from your browser

## File Structure

```
linkedin-notion-extension/
├── manifest.json         # Extension configuration
├── popup.html           # Extension popup interface
├── popup.js             # Popup logic
├── content.js           # LinkedIn page scraper
├── background.js        # Notion API handler
├── icons/               # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # This file
```

## Future Enhancements

Potential features to add:
- Bulk save multiple jobs from search results
- Custom field mapping
- Tags/categories support
- Application status tracking
- Duplicate detection
- Export to other platforms (Airtable, Google Sheets, etc.)

## License

Feel free to modify and use this extension for your personal use!

## Support

If you encounter issues:
1. Check the browser console for error messages (F12 → Console)
2. Verify all setup steps were completed correctly
3. Make sure LinkedIn hasn't changed their page structure

---

Happy job hunting! 🚀
