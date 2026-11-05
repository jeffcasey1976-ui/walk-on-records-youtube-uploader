# Walk On Records YouTube Uploader

Browser app (static HTML/JS) to upload videos or Shorts to multiple YouTube channels.
Matches the style of the Walk On Records Video Maker. History and Client ID stay in this browser (IndexedDB).

## Features
- Drop a video, set title, description, tags, category
- Privacy or schedule (future time → uploads as private with publishAt)
- Multi-channel: Connect / Switch Account picks the Google login or brand channel
- Upload history list (this browser only)
- Resumable uploads via YouTube Data API v3

## Setup
1. Google Cloud Console → enable **YouTube Data API v3**
2. Create an OAuth 2.0 Client ID of type **Web application**
3. Add your site origins to **Authorized JavaScript origins** (e.g. `https://your-site.netlify.app`, `http://localhost:8765`, GitHub Pages URL)
4. Copy the Client ID into the app and click Save Client ID
5. Click Connect and choose the account/channel

## Run locally
```bash
cd youtube-uploader
python3 -m http.server 8765
# open http://localhost:8765
```

## Deploy to GitHub Pages
1. This repo is already set up.
2. Go to the repo → Settings → Pages
3. Source: Deploy from a branch → Branch: main → Folder: / (root) → Save
4. After a minute the site will be live at:
   `https://jeffcasey1976-ui.github.io/walk-on-records-youtube-uploader/`
5. Add that exact origin to your Google OAuth Client ID → Authorized JavaScript origins

## Netlify
Drag the folder or connect the repo (static site).

## Quota
Default project: 100 `videos.insert` calls per day (shared across channels using the same project).
