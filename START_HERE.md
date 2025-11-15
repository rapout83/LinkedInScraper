# 🚀 START HERE - LinkedIn to Notion Job Saver

Welcome! This Chrome extension lets you save LinkedIn job postings to your Notion database with one click.

---

## 📚 Documentation Overview

Your extension includes these helpful guides:

### 🏃 **QUICKSTART.md** ← Start here!
5-minute setup guide to get you up and running fast.

### 📖 **README.md**
Complete documentation with detailed setup instructions and features.

### 🔧 **TROUBLESHOOTING.md**
Having issues? Check this comprehensive troubleshooting guide.

### 🎨 **CUSTOMIZATION.md**
Want to add features or modify the extension? All customization options explained.

### 🏗️ **ARCHITECTURE.md**
Technical documentation explaining how the extension works.

---

## ⚡ Quick Install (3 Steps)

### 1️⃣ Setup Notion (5 min)
- Create a Notion integration: https://www.notion.so/my-integrations
- Create a database with these columns: Name, Company, Location, Work Type, URL, Contact Person
- Connect your integration to the database
- Get your Database ID from the URL

### 2️⃣ Install Extension (1 min)
- Open Chrome: `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked"
- Select this folder: `linkedin-notion-extension`

### 3️⃣ Configure (1 min)
- Click the extension icon
- Enter your Notion Integration Token
- Enter your Database ID
- Click "Save Configuration"

### ✅ Done!
Visit any LinkedIn job posting and click "Save Job to Notion"

---

## 📁 What's Included

```
linkedin-notion-extension/
├── 📄 START_HERE.md          ← You are here
├── 📄 QUICKSTART.md           ← Begin setup
├── 📄 README.md               ← Full documentation  
├── 📄 TROUBLESHOOTING.md      ← Fix issues
├── 📄 CUSTOMIZATION.md        ← Add features
├── 📄 ARCHITECTURE.md         ← Technical details
├── 📄 manifest.json           ← Extension config
├── 📄 popup.html              ← User interface
├── 📄 popup.js                ← UI logic
├── 📄 content.js              ← Scraper
├── 📄 background.js           ← Notion API handler
└── 📁 icons/                  ← Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🎯 What This Extension Does

### Captures from LinkedIn:
✅ Job Title  
✅ Company Name & Logo  
✅ Location  
✅ Work Type (Remote/Hybrid/On-site)  
✅ Full Job Description  
✅ Contact Person (if available)  
✅ Job URL  

### Saves to Notion:
✅ Creates a new page in your database  
✅ Fills all properties automatically  
✅ Adds company logo as page icon  
✅ Includes full job description in page content  

---

## 🆘 Need Help?

### Common Issues:

**"Could not extract job data"**  
→ Make sure you're on a job posting page (not search results)  
→ See TROUBLESHOOTING.md

**"Failed to save to Notion"**  
→ Check you've connected the integration to your database  
→ Verify column names match exactly  
→ See TROUBLESHOOTING.md

**Extension not working**  
→ Make sure Developer Mode is enabled  
→ Try reloading the extension  
→ See TROUBLESHOOTING.md

---

## 🔐 Privacy & Security

- Your Notion credentials are stored locally in Chrome
- No data is sent to any third-party servers
- Direct communication between your browser and Notion
- Open source - inspect the code yourself!

---

## 🎨 Want to Customize?

Check out **CUSTOMIZATION.md** for ideas like:
- Adding more fields to scrape
- Supporting other job sites (Indeed, Glassdoor, etc.)
- Auto-save when visiting job pages
- Adding tags and categories
- Tracking statistics
- And much more!

---

## 📊 Required Notion Database Structure

Your Notion database needs these properties:

| Property Name | Type | Required |
|--------------|------|----------|
| Name | Title | ✅ Yes |
| Company | Text | ✅ Yes |
| Location | Text | ✅ Yes |
| Work Type | Select* | ✅ Yes |
| URL | URL | ✅ Yes |
| Contact Person | Text | ✅ Yes |

*For Work Type, add these options: Remote, Hybrid, On-site

---

## 🐛 Found a Bug?

1. Check TROUBLESHOOTING.md first
2. Look at browser console for errors (F12)
3. LinkedIn frequently updates their HTML - you may need to update selectors in content.js

---

## 🚀 Ready to Get Started?

**👉 Open QUICKSTART.md and follow the 5-minute setup!**

Then start saving jobs with one click! 🎉

---

## 💡 Pro Tips

- Pin the extension to your toolbar for quick access
- Create different Notion databases for different job types
- Use Notion filters to organize your saved jobs
- Add custom fields to track application status, interviews, etc.
- Set up Notion automations to get notifications

---

Happy job hunting! 🎯

Questions? Check the documentation files - everything is explained in detail!
