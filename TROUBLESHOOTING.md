# Troubleshooting Checklist

## ❌ Problem: "Could not extract job data"

### Check these:
- [ ] Are you on a job posting page? (URL should be: `linkedin.com/jobs/view/[number]`)
- [ ] Is the page fully loaded? (Wait a few seconds and try again)
- [ ] Try scrolling down to load all content
- [ ] Try refreshing the page (F5)
- [ ] Check browser console for errors (F12 → Console tab)

### Still not working?
LinkedIn may have changed their HTML structure. You'll need to update the selectors in `content.js`:
1. Right-click on the job title → "Inspect"
2. Find the element's class name
3. Update the selector in `content.js` line ~28

---

## ❌ Problem: "Failed to save to Notion"

### Common causes:

#### 1. Integration not connected to database
- [ ] Open your Notion database
- [ ] Click "..." (top right)
- [ ] Click "Add connections"
- [ ] Select your integration
- [ ] Try saving again

#### 2. Wrong credentials
- [ ] Double-check your Integration Token (starts with `secret_`)
- [ ] Verify Database ID is exactly 32 characters
- [ ] No extra spaces when copy-pasting
- [ ] Re-save configuration in extension

#### 3. Missing database properties
Your Notion database MUST have these exact property names (case-sensitive):
- [ ] Name (Title type)
- [ ] Company (Text type)
- [ ] Location (Text type)
- [ ] Work Type (Select type with options: Remote, Hybrid, On-site)
- [ ] URL (URL type)
- [ ] Contact Person (Text type)

#### 4. API errors
- [ ] Check if Notion is down: https://status.notion.so/
- [ ] Try making a test page manually in the database
- [ ] Regenerate integration token and update in extension

---

## ❌ Problem: Extension icon not visible

- [ ] Go to `chrome://extensions/`
- [ ] Make sure extension is enabled (blue toggle)
- [ ] Click the puzzle icon in Chrome toolbar
- [ ] Pin "LinkedIn to Notion Job Saver"

---

## ❌ Problem: "Please navigate to a LinkedIn job posting page"

- [ ] Make sure you're on `linkedin.com/jobs/view/...` not just search results
- [ ] Try clicking into an actual job posting
- [ ] Refresh the extension popup

---

## ❌ Problem: Some fields are empty in Notion

This is normal! Not all job postings have all fields:
- **Company Logo**: Some companies don't have logos
- **Contact Person**: Many postings don't show recruiters
- **Work Type**: Sometimes needs to be inferred from location

You can:
1. Fill these in manually in Notion after saving
2. Modify `content.js` to look for additional selectors
3. Add fallback values in `background.js`

---

## 🔍 How to Debug

### Step 1: Open Developer Console
1. Click extension icon
2. Right-click anywhere in the popup
3. Select "Inspect"
4. Go to "Console" tab

### Step 2: Check for Errors
Look for red error messages. Common ones:

**"Cannot read property of null"**
→ LinkedIn changed their HTML structure, update selectors

**"Failed to fetch"**
→ Network issue or wrong Notion credentials

**"Invalid database_id"**
→ Database ID is wrong or malformed

### Step 3: Test Notion API Directly
Use this curl command to test your credentials:

```bash
curl -X POST https://api.notion.com/v1/databases/YOUR_DATABASE_ID/query \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json"
```

If this fails, your credentials are wrong.

---

## 🛠️ Advanced Debugging

### Enable verbose logging
Add this to the top of `popup.js`:
```javascript
const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log('[LinkedIn→Notion]', ...args);
}
```

Then add `log()` statements throughout the code.

### Test scraping manually
1. Open a LinkedIn job page
2. Open browser console (F12)
3. Copy the `scrapeJobData()` function from `popup.js`
4. Paste and run it in console
5. Check what data is returned

---

## 📝 Getting Help

If none of this works:

1. **Check LinkedIn's HTML**:
   - Right-click → Inspect Element
   - Look for class names that have changed
   - Update selectors in `content.js`

2. **Check Notion API docs**:
   - https://developers.notion.com/
   - Verify property types match what you're sending

3. **Browser console errors**:
   - Screenshot any errors
   - Google the error message
   - Check Chrome extension documentation

---

## ✅ Verification Steps

After fixing issues, verify everything works:

- [ ] Extension icon appears in toolbar
- [ ] Popup opens without errors
- [ ] Configuration saves successfully
- [ ] Can scrape data from test job posting
- [ ] Data appears in Notion database
- [ ] All fields are populated correctly

---

## 🔄 Reset Everything

Nuclear option - start fresh:

1. Remove extension from Chrome
2. Delete all saved configuration:
   ```javascript
   // Run in browser console on any page:
   chrome.storage.sync.clear()
   ```
3. Reinstall extension
4. Reconfigure from scratch

---

## 💡 Tips

- Test with simple job postings first
- Not all jobs have all data - that's okay!
- LinkedIn frequently updates their UI - be prepared to update selectors
- Keep a backup of your working `content.js` file
