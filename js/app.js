/**
 * App.js: Main Orchestrator and UI State Controller for DarkCull
 *
 * Supports both:
 * 1. Google Drive Online/Offline Shoot Culling (OAuth2 + Drive API v3)
 * 2. Local Folder Mode (File System Access API window.showDirectoryPicker)
 */

import { driveService } from './driveService.js';
import { cacheStore } from './cacheStore.js';
import { ViewportEngine } from './viewportEngine.js';
import { InputController } from './inputController.js';
import { XmpBuilder } from './xmpBuilder.js';
import { ExifReader } from './exifReader.js';

// RAW extensions recognized
const RAW_EXTS = new Set([
  'RW2', 'ORF', 'DNG', 'ARW', 'CR2', 'CR3', 'NEF', 'RAF',
  'GPR', 'PEF', '3FR', 'FFF', 'X3F', 'SRW', 'CRW'
]);
const JPEG_EXTS = new Set(['JPG', 'JPEG', 'JPE', 'JFIF']);

class DarkCullApp {
  constructor() {
    // State
    this.mode = 'gdrive'; // 'gdrive' | 'local'
    this.currentShoot = null; // { folderId, name, type: 'gdrive'|'local', count }
    this.allPhotos = []; // Logical PhotoItem array
    this.filteredPhotos = []; // Current view subset
    this.activeFilter = 'not-rejected'; // 'not-rejected' | 'unrated' | '3' | '4' | '5' | 'rejected' | 'all'
    this.currentIndex = 0;
    this._anchorPhoto = null; // Tracks current photo in shoot order for relative filter switching & session resume
    this.autoAdvance = true;
    this.gestureMap = {
      up: 'rate_5',
      down: 'reject',
      left: 'rate_3',
      right: 'rate_4',
      longPress: 'undo',
    };
    this.undoStack = []; // History of rating/skip actions for Long-Press & Ctrl+Z Undo
    this.isSyncing = false;
    this.loadToken = 0; // bumped on every folder load; background workers stop when it changes
    this._cachingToken = null;
    this.inflight = new Map(); // jpegFileId -> Promise<Blob> (dedupes viewer vs. background downloads)
    this.xmpSources = new Map(); // photo.id -> xmp file record (local mode)
    this.localFiles = new Map(); // jpegFileId -> File (local mode, in-memory)
    this.localDirHandle = null; // Used in local mode

    // Elements
    this.dom = {
      // Top HUD
      hudFilename: document.getElementById('hudFilename'),
      hudIndex: document.getElementById('hudIndex'),
      hudStarBadge: document.getElementById('hudStarBadge'),
      hudExifPill: document.getElementById('hudExifPill'),
      exifText: document.getElementById('exifText'),
      hudSyncBadge: document.getElementById('hudSyncBadge'),
      hudSyncBtn: document.getElementById('hudSyncBtn'),
      cacheProgressBar: document.getElementById('cacheProgressBar'),
      cacheProgressText: document.getElementById('cacheProgressText'),
      cacheProgressFill: document.getElementById('cacheProgressFill'),

      // Tally & Filter
      tallyTotal: document.getElementById('tallyTotal'),
      tallyUnrated: document.getElementById('tallyUnrated'),
      tally3: document.getElementById('tally3'),
      tally4: document.getElementById('tally4'),
      tally5: document.getElementById('tally5'),
      tallyRejected: document.getElementById('tallyRejected'),
      filterCountNotRejected: document.getElementById('filterCountNotRejected'),
      filterCountUnrated: document.getElementById('filterCountUnrated'),
      filterCount3: document.getElementById('filterCount3'),
      filterCount4: document.getElementById('filterCount4'),
      filterCount5: document.getElementById('filterCount5'),
      filterCountRejected: document.getElementById('filterCountRejected'),
      filterCountAll: document.getElementById('filterCountAll'),
      filterPills: document.querySelectorAll('.filter-pill'),

      // Viewport
      viewport: document.getElementById('viewport'),
      mainImg: document.getElementById('mainImg'),
      emptyState: document.getElementById('emptyState'),
      emptyOpenLocalBtn: document.getElementById('emptyOpenLocalBtn'),
      emptyOpenDriveBtn: document.getElementById('emptyOpenDriveBtn'),
      rawNotice: document.getElementById('rawNotice'),
      rawNoticeFilename: document.getElementById('rawNoticeFilename'),
      loupeIndicator: document.getElementById('loupeIndicator'),
      swipeBadge: document.getElementById('swipeBadge'),
      loadingSpinner: document.getElementById('loadingSpinner'),

      // Bottom Bar / Thumb Dock (Prev / Next Navigation Arrows)
      bottomDock: document.getElementById('bottomDock'),
      btnPrev: document.getElementById('btnPrev'),
      btnNext: document.getElementById('btnNext'),

      // Settings & Modals
      settingsBtn: document.getElementById('settingsBtn'),
      folderSelectBtn: document.getElementById('folderSelectBtn'),
      localFolderBtn: document.getElementById('localFolderBtn'),
      settingsModal: document.getElementById('settingsModal'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      clientIdInput: document.getElementById('clientIdInput'),
      saveClientIdBtn: document.getElementById('saveClientIdBtn'),
      clearClientIdBtn: document.getElementById('clearClientIdBtn'),
      manualTokenInput: document.getElementById('manualTokenInput'),
      saveManualTokenBtn: document.getElementById('saveManualTokenBtn'),
      clearManualTokenBtn: document.getElementById('clearManualTokenBtn'),
      gestureUpSelect: document.getElementById('gestureUpSelect'),
      gestureDownSelect: document.getElementById('gestureDownSelect'),
      gestureLeftSelect: document.getElementById('gestureLeftSelect'),
      gestureRightSelect: document.getElementById('gestureRightSelect'),
      gestureHoldSelect: document.getElementById('gestureHoldSelect'),
      presetStarsBtn: document.getElementById('presetStarsBtn'),
      presetRejectSkipBtn: document.getElementById('presetRejectSkipBtn'),
      autoAdvanceToggle: document.getElementById('autoAdvanceToggle'),
      cacheEntireShootBtn: document.getElementById('cacheEntireShootBtn'),
      clearCacheBtn: document.getElementById('clearCacheBtn'),
      storageQuotaText: document.getElementById('storageQuotaText'),

      // Folder Picker Modal
      folderModal: document.getElementById('folderModal'),
      closeFolderModalBtn: document.getElementById('closeFolderModalBtn'),
      folderList: document.getElementById('folderList'),
      manualFolderInput: document.getElementById('manualFolderInput'),
      loadManualFolderBtn: document.getElementById('loadManualFolderBtn'),
      folderLoading: document.getElementById('folderLoading'),
      toast: document.getElementById('toast'),
    };

    this.init();
  }

  async init() {
    this._initSettings();
    this._initViewportEngine();
    this._initInputController();
    this._bindEvents();
    await this._updateStorageStatus();

    // Check for last opened shoot in localStorage
    const lastFolderId = localStorage.getItem('darkcull_last_folder_id');
    if (lastFolderId) {
      const shoot = await cacheStore.getShoot(lastFolderId);
      if (shoot) {
        await this.loadShootFromCache(shoot);
      }
    }

    // Only flush AFTER the shoot is restored so live photo records (with xmpFileId) are available
    this._checkOfflineQueue();
  }

  _initSettings() {
    const savedClientId = driveService.getClientId();
    if (savedClientId && this.dom.clientIdInput) {
      this.dom.clientIdInput.value = savedClientId;
    }

    const savedToken = driveService.getManualToken();
    if (savedToken && this.dom.manualTokenInput) {
      this.dom.manualTokenInput.value = savedToken;
    }

    const savedAutoAdvance = localStorage.getItem('darkcull_auto_advance');
    this.autoAdvance = savedAutoAdvance === null ? true : savedAutoAdvance === 'true';
    if (this.dom.autoAdvanceToggle) {
      this.dom.autoAdvanceToggle.checked = this.autoAdvance;
    }

    try {
      const rawMap = localStorage.getItem('darkcull_gesture_map');
      if (rawMap) {
        const parsed = JSON.parse(rawMap);
        this.gestureMap = { ...this.gestureMap, ...parsed };
      } else if (localStorage.getItem('darkcull_reject_skip_mode') === 'true') {
        this.gestureMap = {
          up: 'skip',
          down: 'reject',
          left: 'reject',
          right: 'skip',
          longPress: 'undo',
        };
      }
    } catch (e) {
      console.warn('Could not load saved gesture map:', e);
    }
    this._syncGestureSelectsUI();
  }

  _syncGestureSelectsUI() {
    if (this.dom.gestureUpSelect) this.dom.gestureUpSelect.value = this.gestureMap.up;
    if (this.dom.gestureDownSelect) this.dom.gestureDownSelect.value = this.gestureMap.down;
    if (this.dom.gestureLeftSelect) this.dom.gestureLeftSelect.value = this.gestureMap.left;
    if (this.dom.gestureRightSelect) this.dom.gestureRightSelect.value = this.gestureMap.right;
    if (this.dom.gestureHoldSelect) this.dom.gestureHoldSelect.value = this.gestureMap.longPress;
  }

  _saveGestureMap() {
    try {
      localStorage.setItem('darkcull_gesture_map', JSON.stringify(this.gestureMap));
    } catch (e) {
      console.warn('Failed to save gesture map:', e);
    }
  }

  _initViewportEngine() {
    this.viewportEngine = new ViewportEngine({
      container: this.dom.viewport,
      imgElement: this.dom.mainImg,
      loupeOverlay: this.dom.loupeIndicator,
      rawNotice: this.dom.rawNotice,
      rawNoticeFilename: this.dom.rawNoticeFilename,
      onLoadingChange: (isLoading) => {
        if (this.dom.loadingSpinner) this.dom.loadingSpinner.classList.toggle('visible', isLoading);
      },
      getBlobFn: async (photo) => {
        return await this.fetchPhotoBlob(photo);
      },
    });
  }

  _initInputController() {
    this.inputController = new InputController({
      touchContainer: this.dom.viewport,
      imgElement: this.dom.mainImg,
      swipeBadge: this.dom.swipeBadge,
      isZoomedFn: () => this.viewportEngine.isZoomed,
      getGestureMapFn: () => this.gestureMap,
      onNext: () => this.nextPhoto(),
      onPrev: () => this.prevPhoto(),
      onRate: (rating) => this.setRating(rating),
      onSkip: () => this.skipPhoto(),
      onUndo: () => this.undoLastAction(),
      onToggleZoom: (x, y) => this.viewportEngine.toggleZoom(x, y),
      onToggleFullscreen: () => this.toggleFullscreen(),
    });
  }

  _bindEvents() {
    // Filter pills
    this.dom.filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.dom.filterPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.setFilter(pill.dataset.filter);
      });
    });

    // Bottom Dock Navigation Arrows
    if (this.dom.btnPrev) this.dom.btnPrev.addEventListener('click', () => this.prevPhoto());
    if (this.dom.btnNext) this.dom.btnNext.addEventListener('click', () => this.nextPhoto());

    // Settings Modal
    this.dom.settingsBtn.addEventListener('click', () => {
      this._updateStorageStatus();
      this.dom.settingsModal.classList.add('open');
    });
    this.dom.closeSettingsBtn.addEventListener('click', () => {
      this.dom.settingsModal.classList.remove('open');
    });

    this.dom.saveClientIdBtn.addEventListener('click', () => {
      const val = this.dom.clientIdInput.value.trim();
      driveService.setClientId(val);
      this.showToast('Client ID saved to local storage!');
    });

    if (this.dom.clearClientIdBtn) {
      this.dom.clearClientIdBtn.addEventListener('click', () => {
        driveService.setClientId('');
        this.dom.clientIdInput.value = '';
        this.showToast('Client ID cleared.');
      });
    }

    if (this.dom.saveManualTokenBtn) {
      this.dom.saveManualTokenBtn.addEventListener('click', () => {
        const token = this.dom.manualTokenInput.value.trim();
        driveService.setManualToken(token);
        this.showToast('OAuth Access Token saved to local storage!');
      });
    }

    if (this.dom.clearManualTokenBtn) {
      this.dom.clearManualTokenBtn.addEventListener('click', () => {
        driveService.setManualToken('');
        this.dom.manualTokenInput.value = '';
        this.showToast('Access Token cleared.');
      });
    }

    // Customizable Gesture Select Dropdowns
    const gestureSelects = [
      this.dom.gestureUpSelect,
      this.dom.gestureDownSelect,
      this.dom.gestureLeftSelect,
      this.dom.gestureRightSelect,
      this.dom.gestureHoldSelect,
    ];
    for (const sel of gestureSelects) {
      if (!sel) continue;
      sel.addEventListener('change', (e) => {
        const key = e.target.dataset.gesture;
        if (key) {
          this.gestureMap[key] = e.target.value;
          this._saveGestureMap();
        }
      });
    }

    if (this.dom.presetStarsBtn) {
      this.dom.presetStarsBtn.addEventListener('click', () => {
        this.gestureMap = {
          ...this.gestureMap,
          up: 'rate_5',
          down: 'reject',
          left: 'rate_3',
          right: 'rate_4',
        };
        this._syncGestureSelectsUI();
        this._saveGestureMap();
        this.showToast('Applied 4-Way Stars preset');
      });
    }

    if (this.dom.presetRejectSkipBtn) {
      this.dom.presetRejectSkipBtn.addEventListener('click', () => {
        this.gestureMap = {
          ...this.gestureMap,
          up: 'skip',
          down: 'reject',
          left: 'reject',
          right: 'skip',
        };
        this._syncGestureSelectsUI();
        this._saveGestureMap();
        this.showToast('Applied Reject / Skip preset');
      });
    }

    this.dom.autoAdvanceToggle.addEventListener('change', (e) => {
      this.autoAdvance = e.target.checked;
      localStorage.setItem('darkcull_auto_advance', this.autoAdvance);
    });

    this.dom.clearCacheBtn.addEventListener('click', async () => {
      if (confirm('Clear all downloaded JPEG blobs from local cache? Ratings will remain intact.')) {
        await cacheStore.clearAllBlobs();
        this.viewportEngine.clearCache();
        this._cachingToken = null;
        await this._updateStorageStatus();
        this.showToast('Local image cache cleared.');
      }
    });

    this.dom.cacheEntireShootBtn.addEventListener('click', () => {
      this.cacheEntireShoot();
    });

    // Folder Modals
    this.dom.folderSelectBtn.addEventListener('click', () => {
      this.openFolderPickerModal();
    });
    if (this.dom.emptyOpenDriveBtn) {
      this.dom.emptyOpenDriveBtn.addEventListener('click', () => {
        this.openFolderPickerModal();
      });
    }
    this.dom.closeFolderModalBtn.addEventListener('click', () => {
      this.dom.folderModal.classList.remove('open');
    });

    this.dom.loadManualFolderBtn.addEventListener('click', () => {
      const raw = this.dom.manualFolderInput.value.trim();
      if (!raw) return;
      // Extract ID if URL pasted (e.g. drive.google.com/drive/folders/XYZ)
      const match = raw.match(/folders\/([a-zA-Z0-9_-]+)/);
      const folderId = match ? match[1] : raw;
      this.loadGoogleDriveFolder(folderId, 'Drive Folder');
      this.dom.folderModal.classList.remove('open');
    });

    // Local Directory Picker Mode (zero setup fallback)
    this.dom.localFolderBtn.addEventListener('click', () => {
      this.openLocalFolderPicker();
    });
    if (this.dom.emptyOpenLocalBtn) {
      this.dom.emptyOpenLocalBtn.addEventListener('click', () => {
        this.openLocalFolderPicker();
      });
    }

    // Sync button (user-initiated click: allow interactive OAuth popup if token expired)
    this.dom.hudSyncBtn.addEventListener('click', () => {
      this.flushSyncQueue(true);
    });

    // Online / Offline listeners
    window.addEventListener('online', () => {
      this.showToast('Back online! Syncing ratings...');
      this.flushSyncQueue(false);
    });
    window.addEventListener('offline', () => {
      this.showToast('Offline mode active. Ratings saved locally.');
      this.updateSyncBadge();
    });
  }

  showToast(msg) {
    if (!this.dom.toast) return;
    this.dom.toast.textContent = msg;
    this.dom.toast.classList.add('visible');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      this.dom.toast.classList.remove('visible');
    }, 2800);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // --- Folder Loading & Stem Pairing ---

  async openFolderPickerModal() {
    const hasClientId = Boolean(driveService.getClientId());
    const hasManualToken = Boolean(driveService.getManualToken());

    if (!hasClientId && !hasManualToken) {
      this.dom.settingsModal.classList.add('open');
      this.showToast('Please set your Client ID (Option 1) or Access Token (Option 2) in Settings.');
      return;
    }

    this.dom.folderModal.classList.add('open');
    this.dom.folderLoading.style.display = 'block';
    this.dom.folderList.innerHTML = '';

    try {
      const folders = await driveService.listFolders();
      this.dom.folderLoading.style.display = 'none';

      if (folders.length === 0) {
        this.dom.folderList.innerHTML = '<div class="empty-list">No folders found in Google Drive.</div>';
        return;
      }

      for (const folder of folders) {
        const item = document.createElement('div');
        item.className = 'folder-item';
        item.innerHTML = `
          <div class="folder-name">${this._escape(folder.name)}</div>
          <div class="folder-date">${new Date(folder.modifiedTime).toLocaleDateString()}</div>
        `;
        item.addEventListener('click', () => {
          this.dom.folderModal.classList.remove('open');
          this.loadGoogleDriveFolder(folder.id, folder.name);
        });
        this.dom.folderList.appendChild(item);
      }
    } catch (err) {
      this.dom.folderLoading.style.display = 'none';
      this.dom.folderList.innerHTML = `<div class="error-list">Error: ${this._escape(err.message)}</div>`;
    }
  }

  // --- Progress bar helpers (pct === null -> indeterminate animation) ---

  _showProgress(text, pct = null) {
    clearTimeout(this._progressHideTimer);
    const { cacheProgressBar: bar, cacheProgressText: txt, cacheProgressFill: fill } = this.dom;
    bar.style.display = 'flex';
    txt.textContent = text;
    fill.classList.toggle('indeterminate', pct === null);
    if (pct !== null) fill.style.width = `${pct}%`;
  }

  _hideProgress(delay = 0) {
    clearTimeout(this._progressHideTimer);
    this._progressHideTimer = setTimeout(() => {
      this.dom.cacheProgressBar.style.display = 'none';
    }, delay);
  }

  /**
   * Carry over unsynced local ratings and known XMP file IDs from a previous visit,
   * so re-opening a folder never loses work or creates duplicate .xmp files.
   */
  async _mergeWithSavedState(photos, folderId) {
    const [saved, pending] = await Promise.all([
      cacheStore.getPhotosByFolder(folderId),
      cacheStore.getPendingSyncItems(folderId),
    ]);
    const savedById = new Map(saved.map((p) => [p.id, p]));
    const dirtyIds = new Set(pending.map((i) => i.id));

    for (const p of photos) {
      const s = savedById.get(p.id);
      if (!s) continue;
      if (!p.xmpFileId && s.xmpFileId) p.xmpFileId = s.xmpFileId;
      if (s.cachedBlob) p.cachedBlob = true;
      if (dirtyIds.has(p.id)) {
        p.rating = s.rating === 1 || s.rating === 2 ? 0 : s.rating;
        p.syncStatus = 'dirty';
        p.ratingLoaded = true;
        p.userRated = true;
      } else if (s.rating !== undefined && s.ratingLoaded) {
        p.rating = s.rating === 1 || s.rating === 2 ? 0 : s.rating;
      }
    }
  }

  /**
   * Saves the active filter and current photo spot for this shoot in localStorage
   * so closing/reopening the app or reloading the shoot resumes right where the user left off.
   */
  _saveProgress() {
    if (!this.currentShoot || !this.currentShoot.folderId) return;
    const currentPhoto =
      (this.currentIndex >= 0 && this.filteredPhotos[this.currentIndex]) ||
      this._anchorPhoto;
    const payload = {
      filter: this.activeFilter,
      photoId: currentPhoto ? currentPhoto.id : null,
      stem: currentPhoto ? currentPhoto.stem : null,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(`darkcull_progress_${this.currentShoot.folderId}`, JSON.stringify(payload));
    } catch (e) {
      console.warn('Could not save shoot progress to localStorage:', e);
    }
  }

  /**
   * Restores the saved filter and anchor photo for a shoot from localStorage.
   */
  _restoreProgress(folderId) {
    this._anchorPhoto = null;
    if (!folderId) return false;
    try {
      const raw = localStorage.getItem(`darkcull_progress_${folderId}`);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      const validFilters = new Set(['not-rejected', 'unrated', '3', '4', '5', 'rejected', 'all']);
      if (saved.filter && validFilters.has(saved.filter)) {
        this.activeFilter = saved.filter;
      }
      if (saved.photoId || saved.stem) {
        const match =
          this.allPhotos.find((p) => p.id === saved.photoId) ||
          this.allPhotos.find((p) => p.stem === saved.stem);
        if (match) {
          this._anchorPhoto = match;
          return true;
        }
      }
    } catch (e) {
      console.warn('Could not restore shoot progress:', e);
    }
    return false;
  }

  /** Common "folder is indexed, show it now" step shared by Drive and Local modes. */
  async _presentShoot(photos, folderId, folderName, type) {
    await this._mergeWithSavedState(photos, folderId);

    this.currentShoot = { folderId, name: folderName, type, count: photos.length, updatedAt: Date.now() };
    this.allPhotos = photos;
    this.filteredPhotos = [];
    this.currentIndex = -1;
    const restored = this._restoreProgress(folderId);
    if (!restored && this.allPhotos.length > 0) {
      this._anchorPhoto = this.allPhotos[0];
    }
    this.setFilter(this.activeFilter || 'not-rejected');
    localStorage.setItem('darkcull_last_folder_id', folderId);

    // Persist in the background - never block the first photo on IndexedDB writes
    cacheStore.saveShoot(this.currentShoot).catch(console.warn);
    cacheStore.savePhotos(photos).catch(console.warn);
  }

  /**
   * Scans a Google Drive folder and shows the first photo as soon as the file LIST is indexed.
   * Ratings (tiny .xmp files) and JPEG downloads continue in the background.
   */
  async loadGoogleDriveFolder(folderId, folderName = 'Drive Folder') {
    this.mode = 'gdrive';
    const token = ++this.loadToken; // cancels any previous load's background work
    this.inflight.clear();
    this.xmpSources.clear();

    this._showProgress('Connecting to Google Drive…');

    try {
      const files = await driveService.listFilesInFolder(folderId, (count, pageCount) => {
        if (token === this.loadToken) {
          const pageInfo = pageCount > 1 ? ` (Page ${pageCount})` : '';
          this._showProgress(`Scanning folder… ${count} files found${pageInfo}`);
        }
      });
      if (token !== this.loadToken) return;

      this._showProgress(`Pairing ${files.length} files…`);
      const photos = this._pairFilesIntoPhotos(files, folderId);
      if (photos.length === 0) {
        this._hideProgress();
        this.showToast('No photo pairs (.JPG / RAW) found in folder.');
        return;
      }

      await this._presentShoot(photos, folderId, folderName, 'gdrive');

      let rawCount = 0;
      let jpegCount = 0;
      let xmpCount = 0;
      for (const f of files) {
        const lastDot = f.name.lastIndexOf('.');
        if (lastDot === -1) continue;
        const ext = f.name.substring(lastDot + 1).toUpperCase();
        if (RAW_EXTS.has(ext)) rawCount++;
        else if (JPEG_EXTS.has(ext)) jpegCount++;
        else if (ext === 'XMP') xmpCount++;
      }
      const xmpText = xmpCount > 0 ? `, ${xmpCount} XMP` : '';
      this.showToast(`Loaded ${photos.length} photos (${files.length} files: ${rawCount} RAW, ${jpegCount} JPEG${xmpText})`);

      // Background work: ratings + JPEG caching run in parallel
      this._loadXmpRatings(token);
      this.cacheEntireShoot();
    } catch (err) {
      console.error(err);
      this._hideProgress();
      this.showToast(`Folder load error: ${err.message}`);
    }
  }

  /**
   * Local Directory Picker fallback using File System Access API
   */
  async openLocalFolderPicker() {
    if (!window.showDirectoryPicker) {
      alert('File System Access API is not supported in this browser. Please use Chrome/Edge or Google Drive mode.');
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const token = ++this.loadToken;
      this.localDirHandle = dirHandle;
      this.mode = 'local';
      this.inflight.clear();
      this.xmpSources.clear();
      this.localFiles.clear();

      const folderId = `local_${dirHandle.name}`;
      const folderName = dirHandle.name;

      this._showProgress(`Reading "${folderName}"…`);

      const files = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push({
            // Namespaced by folder so identical filenames in different folders never collide in IndexedDB
            id: `${folderId}/${name}`,
            name,
            mimeType: file.type,
            size: file.size,
            modifiedTime: file.lastModified,
            fileObj: file,
          });
          if (files.length % 100 === 0) this._showProgress(`Reading "${folderName}"… ${files.length} files`);
        }
      }
      if (token !== this.loadToken) return;

      for (const f of files) this.localFiles.set(f.id, f.fileObj);

      const photos = this._pairFilesIntoPhotos(files, folderId);
      if (photos.length === 0) {
        this._hideProgress();
        this.showToast('No photo pairs found in this directory.');
        return;
      }

      await this._presentShoot(photos, folderId, folderName, 'local');
      this.showToast(`Loaded ${photos.length} local photos`);

      this._loadXmpRatings(token);
      this.cacheEntireShoot(); // persists blobs to IndexedDB in the background
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        this._hideProgress();
        this.showToast(`Local folder error: ${err.message}`);
      }
    }
  }

  /**
   * Background: read each existing .xmp (tiny) with a small worker pool and apply its rating.
   * Never overwrites a rating the user has set in this session.
   */
  async _loadXmpRatings(token) {
    const todo = this.allPhotos.filter((p) => !p.ratingLoaded);
    if (todo.length === 0) return;

    let next = 0;
    let done = 0;

    const worker = async () => {
      while (token === this.loadToken && next < todo.length) {
        const photo = todo[next++];
        try {
          let text = '';
          if (this.mode === 'gdrive') {
            text = await driveService.downloadText(photo.xmpFileId);
          } else {
            const src = this.xmpSources.get(photo.id);
            if (src && src.fileObj) text = await src.fileObj.text();
          }
          if (text) {
            await cacheStore.saveXmpContent(photo.id, text);
            if (!photo.userRated && photo.syncStatus !== 'dirty') {
              photo.rating = XmpBuilder.parseRating(text);
            }
          }
        } catch (e) {
          console.warn(`Could not read XMP for ${photo.stem}:`, e);
        } finally {
          photo.ratingLoaded = true;
          done++;
          this._scheduleRefresh();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
    if (token !== this.loadToken) return;

    this._scheduleRefresh();
    cacheStore.savePhotos(this.allPhotos).catch(console.warn);
  }

  /** Coalesce many background rating updates into one UI refresh. */
  _scheduleRefresh() {
    if (this._refreshTimer) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.updateTallies();
      this._applyFilter(false, true);
    }, 400);
  }

  async loadShootFromCache(shoot) {
    this.currentShoot = shoot;
    this.mode = shoot.type || 'gdrive';
    const photos = await cacheStore.getPhotosByFolder(shoot.folderId);
    if (photos && photos.length > 0) {
      // Normalize any legacy darktable default 1 or 2 ratings to 0 (Unrated)
      for (const p of photos) {
        if (p.rating === 1 || p.rating === 2) {
          p.rating = 0;
        }
      }
      this.allPhotos = photos;
      this.filteredPhotos = [];
      this.currentIndex = -1;
      const restored = this._restoreProgress(shoot.folderId);
      if (!restored && this.allPhotos.length > 0) {
        this._anchorPhoto = this.allPhotos[0];
      }
      this.setFilter(this.activeFilter || 'not-rejected');
      const posText =
        restored && this.currentIndex >= 0
          ? ` — resumed at ${this.currentIndex + 1}/${this.filteredPhotos.length}`
          : '';
      this.showToast(`Restored shoot: ${shoot.name} (${photos.length} photos${posText})`);
    }
  }

  /**
   * Stem Pairing (synchronous & instant - no network):
   * Groups files by basename (case-insensitive) and pairs RAW, JPEG, and XMP.
   * Existing XMP ratings are loaded later in the background by _loadXmpRatings().
   */
  _pairFilesIntoPhotos(files, folderId) {
    // Map: lowerStem -> { stem, rawFile, jpegFile, xmpFile }
    const stemMap = new Map();

    for (const f of files) {
      const name = (f.name || '').trim();
      const lastDot = name.lastIndexOf('.');
      if (lastDot === -1) continue;

      let stem = name.substring(0, lastDot).trim();
      const ext = name.substring(lastDot + 1).toUpperCase();

      // Check for double extension: P1010234.RW2.xmp
      const isXmp = ext === 'XMP';
      if (isXmp) {
        const secondDot = stem.lastIndexOf('.');
        if (secondDot !== -1) {
          const rawSubExt = stem.substring(secondDot + 1).toUpperCase();
          if (RAW_EXTS.has(rawSubExt)) {
            stem = stem.substring(0, secondDot).trim();
          }
        }
      }

      const lowerStem = stem.toLowerCase();
      if (!stemMap.has(lowerStem)) {
        stemMap.set(lowerStem, { stem, rawFile: null, jpegFile: null, xmpFile: null });
      }

      const entry = stemMap.get(lowerStem);
      if (isXmp) {
        // Prefer the darktable-standard [raw].[ext].xmp over a bare [stem].xmp if both exist
        const isDtStyle = stem !== name.substring(0, lastDot);
        if (!entry.xmpFile || isDtStyle) entry.xmpFile = f;
      } else if (RAW_EXTS.has(ext)) {
        entry.rawFile = f;
      } else if (JPEG_EXTS.has(ext)) {
        entry.jpegFile = f;
      }
    }

    // Secondary pass: Pair unpaired RAW and JPEG files that share the exact numeric sequence
    // (e.g. Panasonic/Olympus AdobeRGB "_1010234.ORF" and sRGB "P1010234.JPG", or Canon "_MG_1234" and "IMG_1234")
    const unpairedRaws = [];
    const unpairedJpegs = [];

    for (const [key, entry] of stemMap.entries()) {
      if (entry.rawFile && !entry.jpegFile) {
        unpairedRaws.push({ key, entry });
      } else if (!entry.rawFile && entry.jpegFile) {
        unpairedJpegs.push({ key, entry });
      }
    }

    if (unpairedRaws.length > 0 && unpairedJpegs.length > 0) {
      const numMap = new Map();
      for (const j of unpairedJpegs) {
        const m = j.entry.stem.match(/(\d{3,})$/);
        if (m) {
          const num = m[1];
          if (!numMap.has(num)) numMap.set(num, []);
          numMap.get(num).push(j);
        }
      }

      for (const r of unpairedRaws) {
        const m = r.entry.stem.match(/(\d{3,})$/);
        if (m) {
          const num = m[1];
          const candidates = numMap.get(num);
          if (candidates && candidates.length === 1) {
            const j = candidates[0];
            // Merge companion JPEG into RAW entry
            r.entry.jpegFile = j.entry.jpegFile;
            if (j.entry.xmpFile && !r.entry.xmpFile) {
              r.entry.xmpFile = j.entry.xmpFile;
            }
            stemMap.delete(j.key);
            candidates.length = 0; // consumed
          }
        }
      }
    }

    const photos = [];

    for (const entry of stemMap.values()) {
      // Must have at least a JPEG or a RAW file
      if (!entry.jpegFile && !entry.rawFile) continue;

      const stem = entry.stem;
      const rawName = entry.rawFile ? entry.rawFile.name : null;
      const jpegName = entry.jpegFile ? entry.jpegFile.name : null;

      // Darktable standard sidecar name
      const xmpName = XmpBuilder.determineSidecarName(rawName, jpegName);

      const photo = {
        id: `${folderId}:${stem}`,
        folderId,
        stem,
        jpegFileId: entry.jpegFile ? entry.jpegFile.id : null,
        jpegName,
        rawFileId: entry.rawFile ? entry.rawFile.id : null,
        rawName,
        xmpFileId: entry.xmpFile ? entry.xmpFile.id : null,
        xmpName: entry.xmpFile ? entry.xmpFile.name : xmpName,
        rating: 0,
        cachedBlob: false,
        syncStatus: 'synced',
        // false until the existing .xmp has been read in the background
        ratingLoaded: !entry.xmpFile,
      };

      if (entry.xmpFile) this.xmpSources.set(photo.id, entry.xmpFile);
      photos.push(photo);
    }

    // Sort alphabetically by stem
    photos.sort((a, b) => a.stem.localeCompare(b.stem, undefined, { numeric: true }));
    return photos;
  }

  // --- Image Blob Retrieval & Concurrency Pool Downloader ---

  /**
   * Download one JPEG into IndexedDB. Concurrent callers (the viewer AND the background
   * cache workers) share a single request per file instead of downloading it twice.
   */
  _downloadJpeg(photo) {
    const key = photo.jpegFileId;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = (async () => {
      let blob = null;
      if (this.mode === 'gdrive') {
        blob = await driveService.downloadBlob(key);
      } else {
        blob = this.localFiles.get(key) || null;
      }
      if (blob) {
        await cacheStore.saveBlob(key, blob);
        photo.cachedBlob = true;
      }
      return blob;
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  async fetchPhotoBlob(photo) {
    if (!photo || !photo.jpegFileId) return null;

    // Local files already open in memory are instant
    if (this.mode === 'local' && this.localFiles.has(photo.jpegFileId)) {
      return this.localFiles.get(photo.jpegFileId);
    }

    // IndexedDB next
    const cached = await cacheStore.getBlob(photo.jpegFileId);
    if (cached) return cached;

    // Otherwise download on demand (jumps the queue, shares in-flight request)
    try {
      return await this._downloadJpeg(photo);
    } catch (e) {
      console.error(`Failed to download blob for ${photo.stem}:`, e);
      return null;
    }
  }

  /**
   * Background caching with a pool of 6 workers.
   * Files nearest AFTER the photo you're currently viewing are fetched first, so you can
   * keep culling forward while the rest of the shoot downloads.
   */
  async cacheEntireShoot() {
    if (!this.allPhotos || this.allPhotos.length === 0) return;
    const token = this.loadToken;
    if (this._cachingToken === token) return; // already running for this shoot
    this._cachingToken = token;

    const total = this.allPhotos.length;
    this._showProgress(`Checking local cache… 0 / ${total}`);

    const cachedKeys = await cacheStore.getBlobKeys();
    if (token !== this.loadToken) return;

    const order = new Map(this.allPhotos.map((p, i) => [p.id, i]));
    const pending = this.allPhotos.filter((p) => p.jpegFileId && !cachedKeys.has(p.jpegFileId));
    let completed = total - pending.length;
    let failed = 0;

    const updateProgress = () => {
      const pct = Math.round((completed / total) * 100);
      const failNote = failed ? ` · ${failed} failed` : '';
      this._showProgress(`Caching JPEGs: ${completed} / ${total}${failNote}`, pct);
    };
    updateProgress();

    if (pending.length === 0) {
      this._cachingToken = null;
      this._showProgress(`All ${total} photos cached locally ✓`, 100);
      this._hideProgress(3000);
      return;
    }

    // Pick the pending photo closest ahead of the one on screen (wrapping around)
    const pickNext = () => {
      if (pending.length === 0) return null;
      const cur = this.filteredPhotos[this.currentIndex];
      const base = cur ? order.get(cur.id) : 0;
      let idx = pending.findIndex((p) => order.get(p.id) >= base);
      if (idx === -1) idx = 0;
      return pending.splice(idx, 1)[0];
    };

    const worker = async () => {
      let photo;
      while (token === this.loadToken && (photo = pickNext())) {
        try {
          await this._downloadJpeg(photo);
        } catch (err) {
          failed++;
          console.warn(`Worker failed to download ${photo.stem}:`, err);
        } finally {
          completed++;
          updateProgress();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, worker));
    if (token !== this.loadToken) return;

    this._cachingToken = null;
    if (failed) {
      this._showProgress(`Cached ${completed - failed} / ${total} — ${failed} failed (tap Cache Entire Shoot to retry)`, 100);
      this._hideProgress(8000);
    } else {
      this._showProgress(`Finished caching ${total} JPEGs ✓`, 100);
      this._hideProgress(4000);
    }
    await this._updateStorageStatus();
  }

  // --- Filtering & View State ---

  setFilter(filterType) {
    this.activeFilter = filterType;
    this.dom.filterPills.forEach((p) => {
      p.classList.toggle('active', p.dataset.filter === filterType);
    });
    this._applyFilter(false);
    this.updateTallies();
    this._saveProgress();
  }

  _matchesActiveFilter(photo) {
    const r = photo.rating || 0;
    if (this.activeFilter === 'not-rejected') return r !== -1;
    if (this.activeFilter === 'unrated') return r === 0 || r === 1 || r === 2;
    if (this.activeFilter === '3') return r === 3;
    if (this.activeFilter === '4') return r === 4;
    if (this.activeFilter === '5') return r === 5;
    if (this.activeFilter === 'rejected') return r === -1;
    return true; // 'all'
  }

  /**
   * Rebuilds `this.filteredPhotos` while keeping the viewer at the same relative position in the shoot.
   * If the anchor photo matches the active filter, stays on it; otherwise jumps to the next matching
   * photo below/after it in shoot order (or the nearest preceding photo if at the end of the shoot).
   *
   * @param {boolean} resetIndex   if true, jump to the first photo of the new list
   * @param {boolean} keepCurrent  stay on the same photo (by reference) if it still matches -
   *                               used by background rating updates so the image never flickers
   */
  _applyFilter(resetIndex = false, keepCurrent = false) {
    const currentVisible =
      this.currentIndex >= 0 && this.currentIndex < this.filteredPhotos.length
        ? this.filteredPhotos[this.currentIndex]
        : null;
    const anchor = resetIndex ? null : currentVisible || this._anchorPhoto;

    const nextFiltered = [];
    let seenAnchor = false;
    let targetIndex = -1;

    for (let i = 0; i < this.allPhotos.length; i++) {
      const p = this.allPhotos[i];
      if (anchor && p === anchor) {
        seenAnchor = true;
      }
      if (this._matchesActiveFilter(p)) {
        nextFiltered.push(p);
        if (anchor && p === anchor) {
          targetIndex = nextFiltered.length - 1;
        } else if (seenAnchor && targetIndex === -1) {
          // First matching photo after the anchor in shoot order
          targetIndex = nextFiltered.length - 1;
        }
      }
    }

    this.filteredPhotos = nextFiltered;
    this.viewportEngine.setPhotos(this.filteredPhotos);

    if (this.filteredPhotos.length === 0) {
      this.currentIndex = -1;
      if (anchor) this._anchorPhoto = anchor;
      this.dom.emptyState.style.display = 'flex';
      this.dom.mainImg.style.display = 'none';
      this.updateHud();
      return;
    }

    this.dom.emptyState.style.display = 'none';
    this.dom.mainImg.style.display = 'block';

    if (keepCurrent && currentVisible) {
      const idx = this.filteredPhotos.indexOf(currentVisible);
      if (idx !== -1) {
        // Same photo still visible: just re-sync indices, don't reload the image
        this.currentIndex = idx;
        this._anchorPhoto = currentVisible;
        this.viewportEngine.reindex(idx);
        this.updateHud();
        return;
      }
    }

    if (resetIndex) {
      this.currentIndex = 0;
    } else if (targetIndex !== -1) {
      this.currentIndex = targetIndex;
    } else if (seenAnchor) {
      // Anchor was near the end of the shoot and no matching photo existed after it
      this.currentIndex = this.filteredPhotos.length - 1;
    } else {
      this.currentIndex = 0;
    }
    this.renderCurrentPhoto();
  }

  updateTallies() {
    let unrated = 0;
    let r3 = 0;
    let r4 = 0;
    let r5 = 0;
    let rejected = 0;

    for (const p of this.allPhotos) {
      const r = p.rating || 0;
      if (r === -1) rejected++;
      else if (r === 3) r3++;
      else if (r === 4) r4++;
      else if (r === 5) r5++;
      else unrated++;
    }

    const total = this.allPhotos.length;
    const notRejected = total - rejected;

    if (this.dom.tallyTotal) this.dom.tallyTotal.textContent = total;
    if (this.dom.tallyUnrated) this.dom.tallyUnrated.textContent = unrated;
    if (this.dom.tally3) this.dom.tally3.textContent = r3;
    if (this.dom.tally4) this.dom.tally4.textContent = r4;
    if (this.dom.tally5) this.dom.tally5.textContent = r5;
    if (this.dom.tallyRejected) this.dom.tallyRejected.textContent = rejected;

    if (this.dom.filterCountNotRejected) this.dom.filterCountNotRejected.textContent = notRejected;
    if (this.dom.filterCountUnrated) this.dom.filterCountUnrated.textContent = unrated;
    if (this.dom.filterCount3) this.dom.filterCount3.textContent = r3;
    if (this.dom.filterCount4) this.dom.filterCount4.textContent = r4;
    if (this.dom.filterCount5) this.dom.filterCount5.textContent = r5;
    if (this.dom.filterCountRejected) this.dom.filterCountRejected.textContent = rejected;
    if (this.dom.filterCountAll) this.dom.filterCountAll.textContent = total;
  }

  updateHud() {
    if (this.currentIndex < 0 || this.filteredPhotos.length === 0) {
      this.dom.hudFilename.textContent = this.allPhotos.length > 0 ? `No photos in filter` : 'No photos';
      this.dom.hudIndex.textContent = '0 / 0';
      this.dom.hudStarBadge.textContent = '★ -';
      this.dom.hudStarBadge.className = 'hud-badge badge-unrated';
      if (this.dom.hudExifPill) this.dom.hudExifPill.style.display = 'none';
      return;
    }

    const photo = this.filteredPhotos[this.currentIndex];
    const rawTag = photo.rawName ? ` [RAW: ${photo.rawName}]` : '';
    this.dom.hudFilename.textContent = `${photo.jpegName || photo.stem}${rawTag}`;
    this.dom.hudIndex.textContent = `${this.currentIndex + 1} / ${this.filteredPhotos.length}`;

    // Update rating badge
    const badge = this.dom.hudStarBadge;
    if (photo.rating === -1) {
      badge.textContent = '✕ REJECTED';
      badge.className = 'hud-badge badge-reject';
    } else if (!photo.rating || photo.rating === 0) {
      badge.textContent = '★ 0';
      badge.className = 'hud-badge badge-unrated';
    } else {
      badge.textContent = `★ ${photo.rating}`;
      badge.className = `hud-badge badge-rated rate-${photo.rating}`;
    }
  }

  renderCurrentPhoto() {
    if (this.currentIndex < 0 || this.currentIndex >= this.filteredPhotos.length) return;
    this._anchorPhoto = this.filteredPhotos[this.currentIndex];
    this.updateHud();
    this.updateExifDisplay();
    this.viewportEngine.showPhoto(this.currentIndex);
    this._saveProgress();
  }

  async updateExifDisplay() {
    const photo = this.filteredPhotos[this.currentIndex];
    if (!photo) {
      this._applyExifToDom(null);
      return;
    }

    // 1. If already parsed and cached on photo object, display instantly (0ms)
    if (photo.exif !== undefined) {
      this._applyExifToDom(photo.exif);
      return;
    }

    if (!photo.jpegFileId) {
      photo.exif = null;
      this._applyExifToDom(null);
      return;
    }

    // 2. Asynchronously parse EXIF from the first 128KB of JPEG blob without blocking rendering
    const curIdx = this.currentIndex;
    try {
      const blob = await this.fetchPhotoBlob(photo);
      if (blob) {
        const exif = await ExifReader.readFromBlob(blob);
        photo.exif = exif || null;
        if (this.currentIndex === curIdx && this.filteredPhotos[this.currentIndex] === photo) {
          this._applyExifToDom(photo.exif);
        }
      } else {
        photo.exif = null;
        if (this.currentIndex === curIdx) this._applyExifToDom(null);
      }
    } catch (e) {
      photo.exif = null;
      if (this.currentIndex === curIdx) this._applyExifToDom(null);
    }
  }

  _applyExifToDom(exif) {
    if (!this.dom.hudExifPill || !this.dom.exifText) return;
    if (exif && exif.formatted) {
      this.dom.exifText.textContent = exif.formatted;
      this.dom.hudExifPill.style.display = 'inline-flex';
    } else {
      this.dom.hudExifPill.style.display = 'none';
    }
  }

  nextPhoto() {
    if (this.filteredPhotos.length === 0) return;
    if (this.currentIndex < this.filteredPhotos.length - 1) {
      this.currentIndex++;
      this.renderCurrentPhoto();
    }
  }

  prevPhoto() {
    if (this.filteredPhotos.length === 0) return;
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.renderCurrentPhoto();
    }
  }

  /**
   * Skips / Keeps the current photo and advances to the next photo, recording the skip in the undo stack.
   */
  skipPhoto() {
    if (this.filteredPhotos.length === 0 || this.currentIndex < 0) return;
    const photo = this.filteredPhotos[this.currentIndex];
    this.undoStack.push({
      type: 'skip',
      photoId: photo.id,
    });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.nextPhoto();
  }

  /**
   * Undoes the most recent rating or skip action (triggered via Long-Press on mobile or U / Ctrl+Z).
   */
  async undoLastAction() {
    if (!this.undoStack || this.undoStack.length === 0) {
      this.showToast('Nothing to undo');
      return;
    }

    const action = this.undoStack.pop();
    const photo = this.allPhotos.find((p) => p.id === action.photoId);
    if (!photo) {
      this.showToast('Nothing to undo');
      return;
    }

    if (action.type === 'skip') {
      const idx = this.filteredPhotos.indexOf(photo);
      if (idx !== -1) {
        this.currentIndex = idx;
        this.renderCurrentPhoto();
      }
      this.showToast(`↺ Returned to ${photo.jpegName || photo.stem}`);
      return;
    }

    // Restore previous rating
    const restoredRating = action.prevRating ?? 0;
    photo.rating = restoredRating;
    photo.syncStatus = 'dirty';
    photo.userRated = true;
    photo.ratingLoaded = true;
    this.updateTallies();

    this._anchorPhoto = photo;
    if (!this._matchesActiveFilter(photo)) {
      // If active filter hides the restored rating, switch to 'not-rejected' or 'all' so user sees the photo
      this.activeFilter = restoredRating === -1 ? 'all' : 'not-rejected';
      this.dom.filterPills.forEach((p) => {
        p.classList.toggle('active', p.dataset.filter === this.activeFilter);
      });
    }
    this._applyFilter(false);

    const ratingLabel =
      restoredRating === -1
        ? 'Rejected (✕)'
        : restoredRating === 0
        ? 'Unrated (★0)'
        : `★${restoredRating}`;
    this.showToast(`↺ Undid: ${photo.stem} restored to ${ratingLabel}`);

    // Persist + enqueue restored rating to XMP sync queue
    const syncItem = {
      id: photo.id,
      folderId: photo.folderId,
      stem: photo.stem,
      rating: restoredRating,
      timestamp: Date.now(),
      mode: this.mode,
      photoData: { ...photo },
    };
    try {
      await Promise.all([cacheStore.updatePhoto(photo), cacheStore.enqueueSyncItem(syncItem)]);
    } catch (err) {
      console.error('Failed to persist undo rating:', err);
    }
    this.updateSyncBadge();
    this.flushSyncQueue(true);
  }

  // --- Rating & Non-Destructive XMP Background Sync ---

  async setRating(rating) {
    if (this.filteredPhotos.length === 0 || this.currentIndex < 0) return;
    const photo = this.filteredPhotos[this.currentIndex];

    // Push to undo stack before mutating
    this.undoStack.push({
      type: 'rate',
      photoId: photo.id,
      prevRating: photo.rating || 0,
      newRating: rating,
    });
    if (this.undoStack.length > 50) this.undoStack.shift();

    if (photo.rating === rating) {
      if (this.autoAdvance) this.nextPhoto();
      return;
    }

    // 1. Update memory + UI + advance SYNCHRONOUSLY (nothing awaited before this finishes)
    photo.rating = rating;
    photo.syncStatus = 'dirty';
    photo.userRated = true; // background XMP loading must never overwrite this
    photo.ratingLoaded = true;
    this.updateTallies();

    if (!this._matchesActiveFilter(photo)) {
      // Photo left the current filter: list shrinks, same index now points at the next photo
      this._applyFilter(false);
    } else {
      this.updateHud();
      if (this.autoAdvance) this.nextPhoto();
      else this._saveProgress();
    }

    // 2. Persist + enqueue in the background
    const syncItem = {
      id: photo.id,
      folderId: photo.folderId,
      stem: photo.stem,
      rating,
      timestamp: Date.now(),
      mode: this.mode,
      photoData: { ...photo },
    };
    try {
      await Promise.all([cacheStore.updatePhoto(photo), cacheStore.enqueueSyncItem(syncItem)]);
    } catch (err) {
      console.error('Failed to persist rating:', err);
      this.showToast('⚠ Could not save rating locally');
    }
    this.updateSyncBadge();

    // 3. Trigger background sync processor non-blockingly
    this.flushSyncQueue(true);
  }

  async _checkOfflineQueue() {
    await this.updateSyncBadge();
    if (navigator.onLine) {
      // On startup, auto-flush without forcing an unprompted OAuth popup if the 1h token expired
      this.flushSyncQueue(false);
    }
  }

  async updateSyncBadge() {
    const queue = await cacheStore.getPendingSyncItems();
    const count = queue.length;
    const badge = this.dom.hudSyncBadge;

    if (count === 0) {
      badge.textContent = 'Synced';
      badge.className = 'hud-badge badge-synced';
      this.dom.hudSyncBtn.style.display = 'none';
      return;
    }

    const stuckLocal = queue.filter((i) => !this._canSyncItem(i)).length;
    const hasGdrive = queue.some((i) => i.mode === 'gdrive');

    if (stuckLocal === count) {
      badge.textContent = `${count} unsynced — reopen folder`;
    } else if (!navigator.onLine && hasGdrive) {
      badge.textContent = `${count} queued (offline)`;
    } else if (this.isSyncing) {
      badge.textContent = `Syncing ${count} XMP${count === 1 ? '' : 's'}...`;
    } else {
      badge.textContent = `${count} unsynced — tap ↻`;
    }
    badge.className = 'hud-badge badge-syncing';
    this.dom.hudSyncBtn.style.display = 'inline-block';
  }

  /** Local-folder items can only be written while that folder's handle is open this session. */
  _canSyncItem(item) {
    if (item.mode !== 'local') return true;
    return Boolean(this.localDirHandle) && item.folderId === `local_${this.localDirHandle.name}`;
  }

  async _syncOne(item) {
    // Always prefer the LIVE photo object or the latest IndexedDB photo record so xmpFileId
    // learned from an earlier upload is reused (preventing duplicate .xmp files on Drive)
    const live = this.allPhotos.find((p) => p.id === item.id);
    const stored = !live ? await cacheStore.getPhoto(item.id) : null;
    const photo = live || stored || item.photoData;
    if (stored && stored.xmpFileId && !photo.xmpFileId) {
      photo.xmpFileId = stored.xmpFileId;
    }

    // Base document to patch: cached original, else fetch it, so darktable history is never wiped
    let baseXml = await cacheStore.getXmpContent(item.id);
    if (!baseXml && item.mode === 'gdrive' && photo.xmpFileId) {
      baseXml = await driveService.downloadText(photo.xmpFileId);
    } else if (!baseXml && item.mode === 'local') {
      try {
        const existing = await this.localDirHandle.getFileHandle(photo.xmpName);
        baseXml = await (await existing.getFile()).text();
      } catch (_) {
        /* no sidecar yet */
      }
    }

    const newXml = baseXml
      ? XmpBuilder.patchRating(baseXml, item.rating)
      : XmpBuilder.generateMinimalXmp(item.rating);

    if (item.mode === 'gdrive') {
      if (photo.xmpFileId) {
        await driveService.updateXmpFile(photo.xmpFileId, newXml);
      } else {
        const res = await driveService.createXmpFile(photo.folderId, photo.xmpName, newXml);
        photo.xmpFileId = res.id;
        item.photoData.xmpFileId = res.id;
      }
    } else {
      const fileHandle = await this.localDirHandle.getFileHandle(photo.xmpName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(newXml);
      await writable.close();
    }

    await cacheStore.saveXmpContent(item.id, newXml);

    // Only dequeue if the rating wasn't changed again while we were uploading
    const current = await cacheStore.getSyncItem(item.id);
    if (current && current.timestamp === item.timestamp) {
      await cacheStore.removeSyncItem(item.id);
      photo.syncStatus = 'synced';
    }
    await cacheStore.updatePhoto(photo);
  }

  /**
   * Background processor: Non-blockingly syncs dirty XMPs to Drive or local filesystem.
   * Loops until a full pass makes no progress, so ratings made mid-sync are picked up too.
   *
   * @param {boolean} allowInteractiveAuth - if false, skips gdrive items when OAuth token is expired
   *                                         rather than opening an unprompted popup on page load
   */
  async flushSyncQueue(allowInteractiveAuth = false) {
    if (this.isSyncing) return;
    this.isSyncing = true;
    await this.updateSyncBadge();

    try {
      let progressed = true;
      while (progressed) {
        progressed = false;
        const queue = await cacheStore.getPendingSyncItems();
        if (queue.length === 0) break;

        for (const item of queue) {
          if (!this._canSyncItem(item)) continue;
          if (item.mode === 'gdrive') {
            if (!navigator.onLine) continue;
            if (!driveService.isAuthenticated() && !allowInteractiveAuth) continue;
          }
          try {
            await this._syncOne(item);
            progressed = true;
            this.updateSyncBadge();
          } catch (err) {
            console.error(`Sync error on photo ${item.stem}:`, err);
            if (!navigator.onLine) return; // retry when we're back online
          }
        }
      }
    } finally {
      this.isSyncing = false;
      this.updateSyncBadge();
    }
  }

  async _updateStorageStatus() {
    const quota = await cacheStore.getStorageUsage();
    if (this.dom.storageQuotaText && quota.usage) {
      const mbUsed = (quota.usage / (1024 * 1024)).toFixed(1);
      const mbQuota = (quota.quota / (1024 * 1024)).toFixed(0);
      this.dom.storageQuotaText.textContent = `${mbUsed} MB used of ${mbQuota} MB`;
    }
  }

  _escape(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
}

// Bootstrap application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.darkCullApp = new DarkCullApp();
});
