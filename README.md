# DarkCull — Offline-First Google Drive & Local Photo Culling PWA for darktable

DarkCull is a zero-dependency (Vanilla JS/CSS/HTML) Progressive Web App tailored for ultra-fast photo culling (0ms latency, OLED `#000000` theme, 120Hz smooth scrolling) with non-destructive darktable `.xmp` sidecar synchronization.

---

## 🚀 Running the Local Dev Server

To test the application locally on your machine:

```bash
# Option A: Python 3
python3 -m http.server 8000

# Option B: Node.js (npx serve)
npx serve -l 8000
```

Then open your browser to: **`http://localhost:8000`**

---

## ⚡ Instant Testing (No OAuth Needed): "Local Folder Mode"

DarkCull includes a built-in **Local Folder / SD Card Mode** powered by the HTML5 File System Access API (`window.showDirectoryPicker`):
1. Click **"Local"** in the top bar or **"Open Local Folder / SD Card"** on the welcome screen.
2. Select any local folder containing your `.JPG` and RAW files (e.g. `.RW2`, `.ORF`, `.DNG`, `.ARW`, etc.).
3. Test instant keyboard scrubbing (`D` / `A`, `1-5`, `X` for reject, `Space` for 100% 1:1 loupe zoom).
4. Rated photos immediately create or patch darktable-compatible `[RAW_FILENAME].xmp` files directly in your folder!

---

## 🌐 Live Web App (GitHub Pages)

DarkCull is deployed and running live at:
### 👉 **[https://nowitstime.github.io/DarkCull/](https://nowitstime.github.io/DarkCull/)**

> [!NOTE]
> **Zero Secrets in Code**: 100% of credentials live exclusively in your browser's `localStorage`. The public GitHub repository is completely generic and anonymous.

---

## ⚡ Instant Testing (No OAuth Needed): "Local Folder Mode"

DarkCull includes a built-in **Local Folder / SD Card Mode** powered by the HTML5 File System Access API (`window.showDirectoryPicker`):
1. Click **"Local"** in the top bar or **"Open Local Folder / SD Card"** on the welcome screen.
2. Select any local folder containing your `.JPG` and RAW files (e.g. `.RW2`, `.ORF`, `.DNG`, `.ARW`, etc.).
3. Test instant keyboard scrubbing (`D` / `A`, `1-5`, `X` for reject, `Space` for 100% 1:1 loupe zoom).
4. Rated photos immediately create or patch darktable-compatible `[RAW_FILENAME].xmp` files directly in your folder!

---

## 🔑 Authentication Patterns in Settings Modal

DarkCull supports two client-side credential options stored only on your device:

### Option 1: Paste Your Client ID Once (Permanent Setup - Recommended)
1. Go to Google Cloud Console > **Credentials** > Create **OAuth client ID** (Web application).
2. Add your **Authorized JavaScript origins**:
   - `https://nowitstime.github.io`
   - `http://localhost:8000`
3. Paste your `xxxx.apps.googleusercontent.com` Client ID into **Settings ⚙️ > Option 1** and click **Save Client ID**.
4. Now simply click "Drive" to sign in whenever your token expires. If any stranger visits your GitHub Pages site, they will only see an empty setup box asking for their own Client ID.

### Option 2: Direct OAuth Access Token (Temporary / Advanced)
- If you don't want to configure an OAuth Client ID, you can generate a temporary Google Drive access token (e.g. from the Google OAuth 2.0 Playground) and paste it into **Settings ⚙️ > Option 2**.
- DarkCull will authenticate all Drive API calls directly with that Bearer token.

---

## ⌨️ Keyboard Shortcuts & Touch Gestures

| Key / Gesture | Action |
| :--- | :--- |
| `Right Arrow` / `D` / `J` | Next photo |
| `Left Arrow` / `A` / `K` | Previous photo |
| `1`, `2`, `3`, `4`, `5` | Rate photo (1–5 Stars) + Auto-advance |
| `0` | Clear rating (Unrated) |
| `X` / `Backspace` / `Delete` | Reject photo (`-1`) |
| `Space` / `Z` | Toggle 100% 1:1 focus check loupe zoom |
| `F` | Toggle Fullscreen |
| **Swipe Left / Right** | Next / Previous photo (mobile touch) |
| **Double Tap** | Toggle 100% zoom centered on tap coordinate |
| **Drag** | Pan zoomed image |
