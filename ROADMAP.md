# DarkCull — UX & Feature Roadmap

This document tracks upcoming UX explorations, mobile ergonomics improvements, and workflow features for **DarkCull**.

---

## 1. Mobile Left / Right Navigation Ergonomics

### The Problem
On mobile, single-finger 4-way swipes on the photo canvas are mapped to **Tinder-style rapid ratings** (`← ★3`, `→ ★4`, `↑ ★5`, `↓ ✕ Reject` — or `→/↑ Skip`, `←/↓ Reject` in Reject/Skip Mode), and **Long-Press** (`~450ms`) triggers **Undo**.
While this makes rating ultra-fast with one thumb, simply **stepping backward or forward (`<` / `>`) without rating** currently requires reaching down to the bottom dock buttons, which can feel cramped or cumbersome during long shoots.

### Candidate Solutions to Contemplate

#### Option A: Invisible Left / Right Screen-Edge Tap Zones *(Recommended)*
- **How it works**: Tapping (quick tap `< 200ms`, zero swipe movement) on the **outer 15% left or right edge** of the viewport steps to the **Previous** or **Next** photo without changing any rating.
- **Pros**:
  - Zero visual clutter on the OLED canvas.
  - Works naturally with either thumb at any comfortable vertical height along the side of the phone.
  - Does not conflict with 1-finger swipe-to-rate (which requires `> 45px` drag distance), double-tap zoom (center 70% of screen), or long-press undo (`450ms` hold).
- **Cons**: Discoverability requires a subtle one-time hint or optional edge chevron indicator.

#### Option B: Mid-Screen Floating Thumb Chevrons (Auto-Dimming)
- **How it works**: Place two subtle, semi-transparent pill buttons (`‹` and `›`) vertically centered on the left and right edges of the screen (right where the user's thumbs naturally rest when holding a phone).
- **Pros**:
  - High discoverability and zero reach required.
  - Can free up the bottom dock completely on mobile (allowing the bottom dock to be hidden or collapsed when using gesture culling).
- **Cons**: Takes up a small amount of screen real estate on the left/right edges unless set to low opacity (`opacity: 0.25` when idle).

#### Option C: Two-Finger Horizontal Swipe to Navigate
- **How it works**: 1-finger swipe rates the photo; **2-finger horizontal swipe** scrubs backward/forward between photos without rating.
- **Pros**: Zero UI elements added.
- **Cons**: Requires two fingers (harder for one-handed phone use) and must be carefully disambiguated from 2-finger pinch-to-zoom.

#### Option D: Hardware Volume Rocker Navigation (Where Supported) / Full Gesture Mode Toggle
- **How it works**: Add a **"Minimal Mobile Dock"** toggle that hides the bottom rating buttons entirely (since swipes + long-press undo cover all rating actions) and turns the bottom bar into a large, comfortable dual-zone **`[ ← Prev | Next → ]`** thumb pad.
- **Pros**: Eliminates cramped small buttons at the bottom of the screen; massive touch targets.

---

## 2. Skipping / Jumping to a Specific Photo

### The Problem
In shoots with 200–2,000 photos, stepping one photo at a time to reach photo `#650` or finding a specific camera filename (`P1010650`) is impractical.

### Candidate Solutions to Contemplate

#### Option A: Tap-on-Counter (`142 / 1000`) Quick-Jump Modal + Scrub Slider *(Recommended First Step)*
- **How it works**: Tapping the index counter badge (`142 / 1000`) or filename in the top HUD opens a lightweight **Quick Jump Popover**:
  1. **Interactive Range Slider (`1` to `N`)**: Dragging the slider updates the photo number and filename preview in real time; releasing jumps straight to that photo.
  2. **Direct Number / Filename Input**: Type `450` to jump to index `450`, or type `0824` to jump to `P1010824.RW2`.
  3. **Quick Bookmarks**: Buttons for `First (1)`, `Last (N)`, `First Unrated`, and `Last Rated`.
- **Pros**:
  - Zero memory overhead (doesn't require rendering ratusan of thumbnails).
  - Works even before all JPEGs have finished background caching (since filenames and indices are known immediately after folder scan).

#### Option B: Bottom Scrubbing Filmstrip / Timeline Bar
- **How it works**: A thin horizontal progress/scrub track along the bottom of the viewport showing color-coded ticks for rated/rejected photos. Dragging your finger horizontally along the track rapidly scrubs through the shoot using cached blobs.
- **Pros**: Instant visual overview of which sections of a shoot have already been culled vs. unrated gaps.
- **Cons**: On 1,000+ photo shoots, fine-grained single-photo selection on a narrow phone screen requires a magnified scrub loupe.

#### Option C: Virtualized Contact Sheet / Thumbnail Grid Drawer
- **How it works**: A grid button in the top HUD opens a full-screen virtualized grid (3 columns on mobile, 6–8 on desktop) rendering only the visible rows of cached JPEGs with their star/reject badges. Tap any thumbnail to jump into single-photo loupe view at that exact spot.
- **Pros**: Classic Lightroom / Darktable Lighttable overview; easiest way to visually spot a scene change (e.g., jumping from ceremony to reception photos).
- **Cons**: Best paired with downscaled thumbnail generation or `content-visibility: auto` so scrolling 1,000+ high-res JPEGs stays at 120fps.

---

## 3. Future Culling & Darktable Workflow Enhancements

- **Resume Progress & Relative Filter Switching** *(Implemented)*:
  - Automatically remembers the active filter and exact photo spot per shoot in `localStorage`.
  - Switching filters stays at the same relative position in the shoot (landing on the current photo if it matches, or the next matching photo immediately below it in shoot order).
- **Darktable Color Labels (`F1–F5` / Red, Yellow, Green, Blue, Purple)**:
  - Read and write `<darktable:colorlabels>` inside the `.xmp` sidecar alongside `xmp:Rating` for secondary tagging (e.g., marking panoramas, HDR brackets, or client selects).
- **Burst / Focus Peaking Comparison**:
  - Synchronized zoom/pan across 2 consecutive burst frames so you can check eye sharpness at 2.5× zoom and reject the softer frame with one tap.
- **On-Demand Priority Caching Around Jump Point**:
  - When jumping to photo `#500` before the background cacher has reached `#500`, automatically reprioritize the background download worker queue to start from `#500` forward.
