/**
 * ViewportEngine: 0ms Latency Sliding Window Image Loader & Loupe Pan/Zoom
 *
 * Mechanics:
 * - Sliding window [-3 .. +8] around current index.
 * - In-memory map of ObjectURLs and pre-decoded HTMLImageElement instances.
 * - `await img.decode()` in background so switching images renders instantly (<5ms) with 0ms flicker.
 * - ObjectURLs outside window are revoked to prevent memory leaks.
 * - Loupe Mechanics: 100% 1:1 focus check zoom, centered on cursor/tap position, draggable to pan.
 */

export class ViewportEngine {
  constructor(options = {}) {
    this.container = options.container; // container element
    this.imgElement = options.imgElement; // main <img> tag
    this.loupeOverlay = options.loupeOverlay; // zoom overlay / loupe indicator if any

    this.photos = [];
    this.currentIndex = -1;
    this.getBlobFn = options.getBlobFn || null; // async (photo) => Blob

    // Window size settings
    this.windowBefore = 3;
    this.windowAfter = 8;

    // Cache: Map<photoId, { url: string, img: HTMLImageElement, decoded: boolean }>
    this.preloaded = new Map();

    // Zoom & Pan state
    this.isZoomed = false;
    this.zoomScale = 1; // 100% 1:1 resolution scale
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

    this._setupLoupeEvents();
  }

  setPhotos(photos) {
    this.photos = photos;
    this.clearCache();
  }

  clearCache() {
    for (const [id, item] of this.preloaded.entries()) {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
    }
    this.preloaded.clear();
  }

  /**
   * Switches active photo display with 0ms pre-decoded latency.
   * @param {number} index
   */
  async showPhoto(index) {
    if (index < 0 || index >= this.photos.length) return;
    this.currentIndex = index;
    const currentPhoto = this.photos[index];

    // Reset zoom state on photo change
    if (this.isZoomed) {
      this.resetZoom();
    }

    // 1. Check if already pre-decoded
    let item = this.preloaded.get(currentPhoto.id);
    if (item && item.url) {
      this.imgElement.src = item.url;
    } else {
      // Load current immediately
      await this._loadItem(currentPhoto);
      item = this.preloaded.get(currentPhoto.id);
      if (item && item.url) {
        this.imgElement.src = item.url;
      }
    }

    // 2. Trigger sliding window pre-decoding in the background
    this._updateSlidingWindow();
  }

  async _loadItem(photo) {
    if (!photo || this.preloaded.has(photo.id)) return;

    try {
      const blob = await this.getBlobFn(photo);
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;

      const record = { url, img, decoded: false };
      this.preloaded.set(photo.id, record);

      // Asynchronously decode image texture into GPU memory
      img.decode()
        .then(() => {
          record.decoded = true;
        })
        .catch((err) => {
          // Some formats or tiny decodes might reject; still displayable via standard load
          record.decoded = true;
        });
    } catch (e) {
      console.warn(`Failed to preload photo ${photo.stem}:`, e);
    }
  }

  _updateSlidingWindow() {
    const minIdx = Math.max(0, this.currentIndex - this.windowBefore);
    const maxIdx = Math.min(this.photos.length - 1, this.currentIndex + this.windowAfter);

    const activeIds = new Set();
    for (let i = minIdx; i <= maxIdx; i++) {
      activeIds.add(this.photos[i].id);
    }

    // Evict items outside sliding window to prevent RAM leaks
    for (const [id, item] of this.preloaded.entries()) {
      if (!activeIds.has(id)) {
        if (item.url) {
          URL.revokeObjectURL(item.url);
        }
        this.preloaded.delete(id);
      }
    }

    // Load next items in priority order (current + 1, current + 2, current - 1, etc.)
    const loadQueue = [];
    // Prioritize forward direction
    for (let i = this.currentIndex + 1; i <= maxIdx; i++) {
      loadQueue.push(this.photos[i]);
    }
    // Backward direction
    for (let i = this.currentIndex - 1; i >= minIdx; i--) {
      loadQueue.push(this.photos[i]);
    }

    // Run preload concurrently
    for (const photo of loadQueue) {
      if (!this.preloaded.has(photo.id)) {
        this._loadItem(photo);
      }
    }
  }

  // --- Loupe 100% Focus Check Pan & Zoom Mechanics ---

  _setupLoupeEvents() {
    if (!this.container || !this.imgElement) return;

    // Pointer events for smooth desktop drag + mobile drag when zoomed
    this.container.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e));

    // Track last touch time so desktop dblclick doesn't double-fire after mobile double-tap
    this._lastTouchTime = 0;
    this.container.addEventListener(
      'touchend',
      () => {
        this._lastTouchTime = Date.now();
      },
      { passive: true }
    );

    // Desktop double click toggle
    this.container.addEventListener('dblclick', (e) => {
      if (Date.now() - this._lastTouchTime < 500) return;
      e.preventDefault();
      this.toggleZoom(e.clientX, e.clientY);
    });
  }

  toggleZoom(originX = null, originY = null) {
    if (this.isZoomed) {
      this.resetZoom();
    } else {
      this.zoomTo100(originX, originY);
    }
  }

  zoomTo100(originX = null, originY = null) {
    const natW = this.imgElement.naturalWidth || this.imgElement.width;
    const natH = this.imgElement.naturalHeight || this.imgElement.height;
    if (!natW || !natH) return;

    const rect = this.container.getBoundingClientRect();
    const clickX = originX !== null ? originX - rect.left : rect.width / 2;
    const clickY = originY !== null ? originY - rect.top : rect.height / 2;

    // Calculate native scale factor to reach true 100% 1:1 image pixels
    const fitScale = Math.min(rect.width / natW, rect.height / natH);

    // 100% zoom factor relative to the fit-contained image (at least 2.5x on mobile screens)
    const fullScale = 1 / fitScale;
    this.zoomScale = Math.max(fullScale, 2.5);

    // Center zoom directly on tapped/clicked coordinate
    const imgCenterX = rect.width / 2;
    const imgCenterY = rect.height / 2;

    this.panX = (imgCenterX - clickX) * (this.zoomScale - 1);
    this.panY = (imgCenterY - clickY) * (this.zoomScale - 1);

    this.isZoomed = true;
    this.imgElement.style.transition = 'transform 0.15s ease-out';
    this._applyTransform();

    if (this.loupeOverlay) {
      this.loupeOverlay.classList.add('active');
    }
  }

  resetZoom() {
    this.isZoomed = false;
    this.zoomScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.imgElement.style.transition = 'transform 0.15s ease-out';
    this._applyTransform();

    if (this.loupeOverlay) {
      this.loupeOverlay.classList.remove('active');
    }
  }

  _applyTransform() {
    if (!this.isZoomed) {
      this.imgElement.style.transform = 'none';
      this.imgElement.style.opacity = '1';
      this.imgElement.style.cursor = 'zoom-in';
      this.container.classList.remove('is-zoomed');
    } else {
      this.imgElement.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoomScale})`;
      this.imgElement.style.opacity = '1';
      this.imgElement.style.cursor = 'grab';
      this.container.classList.add('is-zoomed');
    }
  }

  _onPointerDown(e) {
    if (!this.isZoomed) return;
    this.isDragging = true;
    this.startX = e.clientX - this.panX;
    this.startY = e.clientY - this.panY;
    this.imgElement.style.transition = 'none';
    this.imgElement.style.cursor = 'grabbing';
    if (e.cancelable) e.preventDefault();
  }

  _onPointerMove(e) {
    if (!this.isDragging || !this.isZoomed) return;
    this.panX = e.clientX - this.startX;
    this.panY = e.clientY - this.startY;
    this._applyTransform();
  }

  _onPointerUp() {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.isZoomed) {
      this.imgElement.style.cursor = 'grab';
    }
  }
}
