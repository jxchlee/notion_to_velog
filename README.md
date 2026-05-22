# Notion to Velog

[한국어](README.ko.md) | **English**

A Chrome extension for copy-pasting Notion content to Velog with automatic image upload.

![preview](assets/preview.webp)

Notion copies images as `![alt](attachment:UUID:filename)` — a format Velog cannot render. This extension intercepts the paste event on `velog.io/write`, uploads each image to the Velog CDN, and replaces the attachment URLs with the resulting CDN URLs before inserting the content into the editor.

---

## Requirements

- Chrome or Brave browser
- A [Notion Integration Token](https://www.notion.so/my-integrations)
- Logged in to [velog.io](https://velog.io)

---

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in your browser
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder

---

## Setup

### 1. Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration** and give it a name
3. Copy the **Internal Integration Token** (`ntn_...`)

### 2. Connect the Integration to your Notion pages

For each Notion page you want to copy from:

1. Open the page in Notion
2. Click **···** (top-right) → **Connections** → select your integration

### 3. Save the token in the extension

Click the extension icon in your browser toolbar, paste the token, and click **저장**.

---

## Usage

1. Open the Notion page you want to publish
2. Press `Ctrl+A` → `Ctrl+C` to copy the entire page
3. Go to `velog.io/write` and press `Ctrl+V`
4. The extension automatically uploads all images and inserts the final markdown

A toast notification at the bottom-right shows progress and the result.

---

## How It Works

```
notion.so                    background.js               velog.io/write
─────────────────────────────────────────────────────────────────────────
notion-content.js scans      FETCH_IMAGE:                content.js intercepts
img[src] → saves             Notion API → S3 URL →       paste event →
UUID→URL map to              download binary             replaces attachment
chrome.storage.local                                     URLs with CDN URLs
                             UPLOAD_TO_VELOG:            → injects processed
                             executeScript(MAIN world)   markdown into editor
                             → POST /api/v2/files/upload
                             → returns CDN URL
```

**Why MAIN world for upload?**  
Velog's upload API requires the `access_token` cookie and same-site request headers. Running `fetch` inside `chrome.scripting.executeScript` with `world: 'MAIN'` executes in the page's context, so the browser automatically attaches the session cookie.

**New post vs. existing post**  
- Editing an existing post (`velog.io/write?id=UUID`): uploads with `type=post` and `ref_id=UUID`
- Writing a new post (no `?id=` param): uploads with `type=profile` as a fallback (images are still accessible and functional)

---

## File Structure

```
notion_to_velog/
├── manifest.json        MV3 manifest
├── background.js        Service worker — image download & Velog upload
├── content.js           velog.io/write — paste intercept & editor injection
├── notion-content.js    notion.so — UUID→URL mapping collection
├── popup.html           Extension popup UI
└── popup.js             Token save/load logic
```

---

## Notes

- The Notion Integration must be connected to the page before copying; otherwise block lookup will return 404.
- S3 presigned URLs from Notion expire in ~1 hour — paste shortly after copying.
- **Brave users**: Brave Shields must be disabled for `notion.so`. Click the Brave lion icon in the address bar while on a Notion page and toggle Shields off.
