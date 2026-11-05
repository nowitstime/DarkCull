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

## 🔑 3-Step Google Cloud Console OAuth Setup (for Google Drive Mode)

To cull directly from your Google Drive folders:

### Step 1: Create a Google Cloud Project & Enable Drive API
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `DarkCull`).
3. In the left navigation, go to **APIs & Services > Library**, search for **Google Drive API**, and click **Enable**.

### Step 2: Configure the OAuth Consent Screen
1. Go to **APIs & Services > OAuth consent screen**.
2. Select **External** (or Internal if using Google Workspace) and click **Create**.
3. Fill in the App Name (`DarkCull`) and your developer contact email.
4. Add the scope: `https://www.googleapis.com/auth/drive`.
5. Under **Test Users**, add your Google email address so you can sign in during development.

### Step 3: Create an OAuth 2.0 Client ID
1. Go to **APIs & Services > Credentials** and click **+ Create Credentials > OAuth client ID**.
2. Select **Web application** as the application type.
3. Under **Authorized JavaScript origins**, add:
   - `http://localhost:8000` (and `http://localhost:3000` or your production domain if hosted on GitHub Pages / Firebase Hosting).
4. Click **Create** and copy your **Client ID** (it looks like `xxxxxxxx.apps.googleusercontent.com`).
5. In DarkCull, click the **Settings ⚙️** icon in the top right, paste your Client ID, and click **Save Client ID**.

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
