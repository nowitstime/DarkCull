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
    this.rawNotice = options.rawNotice || null; // fallback notice for RAW-only shots
    this.rawNoticeFilename = options.rawNoticeFilename || null;

    this.photos = [];
    this.currentIndex = -1;
    this.getBlobFn = options.getBlobFn || null; // async (photo) => Blob
    this.onLoadingChange = options.onLoadingChange || null; // (isLoading) => void
    this._showRequestId = 0;
    this._pendingLoads = new Map(); // photo.id -> Promise (one in-flight load per photo)

    // Window size settings
    this.windowBefore = typeof options.windowBefore === 'number' ? options.windowBefore : 3;
    this.windowAfter = typeof options.windowAfter === 'number' ? options.windowAfter : 8;

    // Cache: Map<photoId, { url: string, img: HTMLImageElement, decoded: boolean }>
    this.preloaded = new Map();

    // Zoom & Pan state
    this.isZoomed = false;
    this.zoomScale = 1;
    this.minZoomScale = 1;
    this.maxZoomScale = typeof options.maxZoomScale === 'number' ? options.maxZoomScale : 6;
    this.panX = 0;
    this.panY = 0;

    // Mouse drag state (desktop)
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

    // Touch pan & 2-finger pinch state (mobile)
    this.isTouchPanning = false;
    this.isPinching = false;
    this._pinchStartDist = 0;
    this._pinchStartScale = 1;
    this._pinchStartMidX = 0;
    this._pinchStartMidY = 0;
    this._pinchStartPanX = 0;
    this._pinchStartPanY = 0;

    this._setupLoupeEvents();
  }

  setPhotos(photos) {
    // Cache is keyed by photo.id, so decoded images stay valid across filter changes.
    // Out-of-window entries get evicted by _updateSlidingWindow().
    this.photos = photos;
  }

  /** Re-sync the sliding window after the list changed but the same photo is still on screen. */
  reindex(index) {
    this.currentIndex = index;
    this._updateSlidingWindow();
  }

  clearCache() {
    for (const [id, item] of this.preloaded.entries()) {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
    }
    this.preloaded.clear();
  }

  _setLoading(isLoading) {
    if (this.onLoadingChange) this.onLoadingChange(isLoading);
  }

  /**
   * Switches active photo display with 0ms pre-decoded latency.
   * @param {number} index
   */
  async showPhoto(index) {
    if (index < 0 || index >= this.photos.length) return;
    this.currentIndex = index;
    const currentPhoto = this.photos[index];
    const requestId = ++this._showRequestId;

    // Reset zoom state on photo change
    if (this.isZoomed || this.zoomScale > 1) {
      this.resetZoom(false);
    }

    // Handle RAW-only shot (no companion JPEG to decode)
    if (!currentPhoto.jpegFileId) {
      this.imgElement.style.display = 'none';
      if (this.rawNotice) {
        this.rawNotice.style.display = 'flex';
        if (this.rawNoticeFilename) {
          this.rawNoticeFilename.textContent = currentPhoto.rawName || currentPhoto.stem;
        }
      }
      this._setLoading(false);
      return;
    }

    if (this.rawNotice) this.rawNotice.style.display = 'none';
    this.imgElement.style.display = 'block';

    // 1. Check if already pre-decoded
    let item = this.preloaded.get(currentPhoto.id);
    if (item && item.url) {
      this.imgElement.src = item.url;
      this._setLoading(false);
    } else {
      // Not ready (still downloading / decoding): show spinner, keep old image until it arrives
      this._setLoading(true);
      await this._loadItem(currentPhoto);

      // The user may have moved on while we waited - never paint a stale photo
      if (requestId !== this._showRequestId) return;

      item = this.preloaded.get(currentPhoto.id);
      if (item && item.url) {
        this.imgElement.src = item.url;
      } else {
        // Blob failed to load or download error
        this.imgElement.style.display = 'none';
        if (this.rawNotice) {
          this.rawNotice.style.display = 'flex';
          if (this.rawNoticeFilename) {
            this.rawNoticeFilename.textContent = `${currentPhoto.jpegName || currentPhoto.stem} (Download error)`;
          }
        }
      }
      this._setLoading(false);
    }

    // 2. Trigger sliding window pre-decoding in the background
    this._updateSlidingWindow();
  }

  _loadItem(photo) {
    if (!photo || this.preloaded.has(photo.id)) return Promise.resolve();
    if (this._pendingLoads.has(photo.id)) return this._pendingLoads.get(photo.id);

    const promise = this._doLoadItem(photo).finally(() => this._pendingLoads.delete(photo.id));
    this._pendingLoads.set(photo.id, promise);
    return promise;
  }

  async _doLoadItem(photo) {
    try {
      const blob = await this.getBlobFn(photo);
      if (!blob || this.preloaded.has(photo.id) || !this.photos.some((p) => p.id === photo.id)) return;

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
        .catch(() => {
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
    for (let i = this.currentIndex + 1; i <= maxIdx; i++) {
      loadQueue.push(this.photos[i]);
    }
    for (let i = this.currentIndex - 1; i >= minIdx; i--) {
      loadQueue.push(this.photos[i]);
    }

    for (const photo of loadQueue) {
      if (!this.preloaded.has(photo.id)) {
        this._loadItem(photo);
      }
    }
  }

  // --- Loupe & Pinch-to-Zoom / Pan Mechanics ---

  _setupLoupeEvents() {
    if (!this.container || !this.imgElement) return;

    // Allow tapping the zoom indicator pill to reset zoom immediately
    if (this.loupeOverlay) {
      this.loupeOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetZoom(true);
      });
      this.loupeOverlay.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
          if (e.cancelable) e.preventDefault();
          this.resetZoom(true);
        },
        { passive: false }
      );
    }

    // 1. Mobile Touch Pinch-to-Zoom & 1-Finger Pan when Zoomed
    this.container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.container.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    this.container.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });

    // 2. Desktop Mouse Drag when Zoomed
    this.container.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', () => this._onMouseUp());

    // 3. Desktop Trackpad Pinch / Mouse Wheel Zoom
    this.container.addEventListener(
      'wheel',
      (e) => {
        if (!this.isZoomed && !e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const targetScale = Math.max(1, Math.min(this.maxZoomScale, this.zoomScale * factor));
        if (targetScale <= 1.04) {
          this.resetZoom(true);
        } else {
          this.zoomToScale(targetScale, e.clientX, e.clientY, false);
        }
      },
      { passive: false }
    );

    // 4. Desktop Double Click toggle (ignored right after touch)
    this._lastTouchTime = 0;
    this.container.addEventListener('dblclick', (e) => {
      if (Date.now() - this._lastTouchTime < 500) return;
      e.preventDefault();
      this.toggleZoom(e.clientX, e.clientY);
    });
  }

  _getTouchDistance(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  _getTouchMidpoint(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
  }

  _onTouchStart(e) {
    this._lastTouchTime = Date.now();

    // Two-finger pinch gesture (works whether currently zoomed or at 1x)
    if (e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      this.isPinching = true;
      this.isTouchPanning = false;

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this._pinchStartDist = Math.max(10, this._getTouchDistance(t1, t2));
      this._pinchStartScale = this.zoomScale || 1;

      const rect = this.container.getBoundingClientRect();
      const mid = this._getTouchMidpoint(t1, t2);
      this._pinchStartMidX = mid.x - rect.left - rect.width / 2;
      this._pinchStartMidY = mid.y - rect.top - rect.height / 2;
      this._pinchStartPanX = this.panX;
      this._pinchStartPanY = this.panY;

      this.imgElement.style.transition = 'none';
      return;
    }

    // Single-finger pan when already zoomed in
    if (e.touches.length === 1 && this.isZoomed) {
      const t = e.touches[0];
      this.isTouchPanning = true;
      this.startX = t.clientX - this.panX;
      this.startY = t.clientY - this.panY;
      this.imgElement.style.transition = 'none';
    }
  }

  _onTouchMove(e) {
    if (this.isPinching && e.touches.length >= 2) {
      if (e.cancelable) e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.max(10, this._getTouchDistance(t1, t2));
      const scaleRatio = dist / this._pinchStartDist;
      const newScale = Math.max(0.9, Math.min(this.maxZoomScale, this._pinchStartScale * scaleRatio));

      const rect = this.container.getBoundingClientRect();
      const mid = this._getTouchMidpoint(t1, t2);
      const curMidX = mid.x - rect.left - rect.width / 2;
      const curMidY = mid.y - rect.top - rect.height / 2;

      // Keep the image point that was under the initial pinch midpoint under the current midpoint
      const actualRatio = newScale / this._pinchStartScale;
      this.zoomScale = newScale;
      this.panX = curMidX - (this._pinchStartMidX - this._pinchStartPanX) * actualRatio;
      this.panY = curMidY - (this._pinchStartMidY - this._pinchStartPanY) * actualRatio;

      this.isZoomed = this.zoomScale > 1.05;
      if (this.isZoomed) {
        this._clampPan();
      }
      this._applyTransform();
      this._updateLoupeBadge();
      return;
    }

    if (this.isTouchPanning && this.isZoomed && e.touches.length === 1) {
      if (e.cancelable) e.preventDefault();
      const t = e.touches[0];
      this.panX = t.clientX - this.startX;
      this.panY = t.clientY - this.startY;
      this._clampPan();
      this._applyTransform();
    }
  }

  _onTouchEnd(e) {
    this._lastTouchTime = Date.now();

    if (this.isPinching) {
      if (e.touches.length < 2) {
        this.isPinching = false;
        if (this.zoomScale <= 1.06) {
          this.resetZoom(true);
        } else {
          this.isZoomed = true;
          this._clampPan();
          this.imgElement.style.transition = 'transform 0.12s ease-out';
          this._applyTransform();
          this._updateLoupeBadge();
          // Seamless handoff if 1 finger remains down on screen after pinching
          if (e.touches.length === 1) {
            this.isTouchPanning = true;
            this.startX = e.touches[0].clientX - this.panX;
            this.startY = e.touches[0].clientY - this.panY;
            this.imgElement.style.transition = 'none';
          }
        }
      }
      return;
    }

    if (e.touches.length === 0) {
      this.isTouchPanning = false;
    }
  }

  toggleZoom(originX = null, originY = null) {
    if (this.isZoomed) {
      this.resetZoom(true);
    } else {
      this.zoomTo100(originX, originY);
    }
  }

  zoomTo100(originX = null, originY = null) {
    const natW = this.imgElement.naturalWidth || this.imgElement.width;
    const natH = this.imgElement.naturalHeight || this.imgElement.height;
    if (!natW || !natH) return;

    const rect = this.container.getBoundingClientRect();
    const fitScale = Math.min(rect.width / natW, rect.height / natH);
    const fullScale = Math.min(this.maxZoomScale, Math.max(1 / fitScale, 2.5));

    this.zoomToScale(fullScale, originX, originY, true);
  }

  zoomToScale(targetScale, originX = null, originY = null, animate = true) {
    const clampedScale = Math.max(this.minZoomScale, Math.min(this.maxZoomScale, targetScale));
    const rect = this.container.getBoundingClientRect();
    const relX = originX !== null ? originX - rect.left - rect.width / 2 : 0;
    const relY = originY !== null ? originY - rect.top - rect.height / 2 : 0;

    const prevScale = this.zoomScale || 1;
    const ratio = clampedScale / prevScale;

    this.zoomScale = clampedScale;
    if (prevScale <= 1.01) {
      this.panX = -relX * (this.zoomScale - 1);
      this.panY = -relY * (this.zoomScale - 1);
    } else {
      this.panX = relX - (relX - this.panX) * ratio;
      this.panY = relY - (relY - this.panY) * ratio;
    }

    this.isZoomed = this.zoomScale > 1.05;
    this._clampPan();

    this.imgElement.style.transition = animate ? 'transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    this._applyTransform();
    this._updateLoupeBadge();
  }

  _getDisplayedImageSize() {
    const rect = this.container.getBoundingClientRect();
    const natW = this.imgElement.naturalWidth || rect.width;
    const natH = this.imgElement.naturalHeight || rect.height;
    if (!natW || !natH) return { width: rect.width, height: rect.height, containerW: rect.width, containerH: rect.height };

    const fitScale = Math.min(rect.width / natW, rect.height / natH);
    return {
      width: natW * fitScale,
      height: natH * fitScale,
      containerW: rect.width,
      containerH: rect.height,
    };
  }

  _clampPan() {
    if (!this.container || !this.imgElement) return;
    const { width, height, containerW, containerH } = this._getDisplayedImageSize();
    const scaledW = width * this.zoomScale;
    const scaledH = height * this.zoomScale;

    const maxPanX = Math.max(0, (scaledW - containerW) / 2);
    const maxPanY = Math.max(0, (scaledH - containerH) / 2);

    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
  }

  _updateLoupeBadge() {
    if (!this.loupeOverlay) return;
    if (this.isZoomed) {
      const rounded = Math.round(this.zoomScale * 10) / 10;
      this.loupeOverlay.textContent = `🔍 ${rounded.toFixed(1)}× · Tap to Reset`;
      this.loupeOverlay.classList.add('active');
    } else {
      this.loupeOverlay.classList.remove('active');
    }
  }

  resetZoom(animate = true) {
    this.isZoomed = false;
    this.isPinching = false;
    this.isTouchPanning = false;
    this.isDragging = false;
    this.zoomScale = 1;
    this.panX = 0;
    this.panY = 0;
    if (this.imgElement) {
      this.imgElement.style.transition = animate ? 'transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
      this._applyTransform();
    }
    this._updateLoupeBadge();
  }

  _applyTransform() {
    if (!this.isZoomed && !this.isPinching) {
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

  _onMouseDown(e) {
    if (!this.isZoomed || e.button !== 0) return;
    this.isDragging = true;
    this.startX = e.clientX - this.panX;
    this.startY = e.clientY - this.panY;
    this.imgElement.style.transition = 'none';
    this.imgElement.style.cursor = 'grabbing';
    if (e.cancelable) e.preventDefault();
  }

  _onMouseMove(e) {
    if (!this.isDragging || !this.isZoomed) return;
    this.panX = e.clientX - this.startX;
    this.panY = e.clientY - this.startY;
    this._clampPan();
    this._applyTransform();
  }

  _onMouseUp() {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.isZoomed) {
      this.imgElement.style.cursor = 'grab';
    }
  }
}
