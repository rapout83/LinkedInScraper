# Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Create Notion Integration (2 min)
1. Visit: https://www.notion.so/my-integrations
2. Click "New integration"
3. Name it "LinkedIn Jobs"
4. Copy the token (starts with `secret_...`)

### 2. Setup Notion Database (2 min)
1. Create a new Notion page
2. Add a Table database
3. Add these columns:
   - Name (Title) ✅ Already exists
   - Company (Text)
   - Location (Text) 
   - Work Type (Select) → Add: Remote, Hybrid, On-site
   - URL (URL)
   - Contact Person (Text)
4. Click "..." → "Add connections" → Select your integration

### 3. Get Database ID (30 sec)
Look at your database URL:
```
notion.so/workspace/[THIS-32-CHAR-STRING]?v=...
                    ↑ Copy this part
```

### 4. Install Extension (30 sec)
1. Go to: `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the extension folder

### 5. Configure Extension (30 sec)
1. Click extension icon
2. Paste Integration Token
3. Paste Database ID
4. Click "Save Configuration"

## ✅ You're Done!

Now visit any LinkedIn job posting and click the extension icon → "Save Job to Notion"

---

## 🎯 Example LinkedIn Job URLs

Test with these:
- https://www.linkedin.com/jobs/view/[any-job-id]/
- Search jobs on LinkedIn and click any posting

## ❓ Common Issues

**Can't save to Notion?**
- Did you connect the integration to your database? (Step 2.4)
- Are all column names spelled exactly as shown? (Case-sensitive!)

**No data scraped?**
- Make sure you're on a job POSTING page (not search results)
- Try refreshing the page

**Extension not showing?**
- Pin it: Click puzzle icon → Pin "LinkedIn to Notion"

---

Need more help? Check the full README.md
