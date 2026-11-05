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

// RAW extensions recognized
const RAW_EXTS = new Set(['RW2', 'ORF', 'DNG', 'ARW', 'CR2', 'CR3', 'NEF', 'RAF']);
const JPEG_EXTS = new Set(['JPG', 'JPEG']);

class DarkCullApp {
  constructor() {
    // State
    this.mode = 'gdrive'; // 'gdrive' | 'local'
    this.currentShoot = null; // { folderId, name, type: 'gdrive'|'local', count }
    this.allPhotos = []; // Logical PhotoItem array
    this.filteredPhotos = []; // Current view subset
    this.activeFilter = 'all'; // 'all' | 'unrated' | '3+' | '4+' | '5' | 'rejected'
    this.currentIndex = 0;
    this.autoAdvance = true;
    this.isSyncing = false;
    this.isCaching = false;
    this.localDirHandle = null; // Used in local mode

    // Elements
    this.dom = {
      // Top HUD
      hudFilename: document.getElementById('hudFilename'),
      hudIndex: document.getElementById('hudIndex'),
      hudStarBadge: document.getElementById('hudStarBadge'),
      hudSyncBadge: document.getElementById('hudSyncBadge'),
      hudSyncBtn: document.getElementById('hudSyncBtn'),
      cacheProgressBar: document.getElementById('cacheProgressBar'),
      cacheProgressText: document.getElementById('cacheProgressText'),
      cacheProgressFill: document.getElementById('cacheProgressFill'),

      // Tally & Filter
      tallyTotal: document.getElementById('tallyTotal'),
      tally3Plus: document.getElementById('tally3Plus'),
      tally4Plus: document.getElementById('tally4Plus'),
      tally5: document.getElementById('tally5'),
      tallyRejected: document.getElementById('tallyRejected'),
      filterPills: document.querySelectorAll('.filter-pill'),

      // Viewport
      viewport: document.getElementById('viewport'),
      mainImg: document.getElementById('mainImg'),
      emptyState: document.getElementById('emptyState'),
      loupeIndicator: document.getElementById('loupeIndicator'),

      // Bottom Bar / Thumb Dock
      btnReject: document.getElementById('btnReject'),
      btnRate0: document.getElementById('btnRate0'),
      btnRate1: document.getElementById('btnRate1'),
      btnRate2: document.getElementById('btnRate2'),
      btnRate3: document.getElementById('btnRate3'),
      btnRate4: document.getElementById('btnRate4'),
      btnRate5: document.getElementById('btnRate5'),
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
    this._checkOfflineQueue();
    await this._updateStorageStatus();

    // Check for last opened shoot in localStorage
    const lastFolderId = localStorage.getItem('darkcull_last_folder_id');
    if (lastFolderId) {
      const shoot = await cacheStore.getShoot(lastFolderId);
      if (shoot) {
        this.loadShootFromCache(shoot);
      }
    }
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
  }

  _initViewportEngine() {
    this.viewportEngine = new ViewportEngine({
      container: this.dom.viewport,
      imgElement: this.dom.mainImg,
      loupeOverlay: this.dom.loupeIndicator,
      getBlobFn: async (photo) => {
        return await this.fetchPhotoBlob(photo);
      },
    });
  }

  _initInputController() {
    this.inputController = new InputController({
      touchContainer: this.dom.viewport,
      onNext: () => this.nextPhoto(),
      onPrev: () => this.prevPhoto(),
      onRate: (rating) => this.setRating(rating),
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

    // Rating buttons (Thumb Dock)
    this.dom.btnReject.addEventListener('click', () => this.setRating(-1));
    this.dom.btnRate0.addEventListener('click', () => this.setRating(0));
    if (this.dom.btnRate1) this.dom.btnRate1.addEventListener('click', () => this.setRating(1));
    if (this.dom.btnRate2) this.dom.btnRate2.addEventListener('click', () => this.setRating(2));
    this.dom.btnRate3.addEventListener('click', () => this.setRating(3));
    this.dom.btnRate4.addEventListener('click', () => this.setRating(4));
    this.dom.btnRate5.addEventListener('click', () => this.setRating(5));

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

    this.dom.autoAdvanceToggle.addEventListener('change', (e) => {
      this.autoAdvance = e.target.checked;
      localStorage.setItem('darkcull_auto_advance', this.autoAdvance);
    });

    this.dom.clearCacheBtn.addEventListener('click', async () => {
      if (confirm('Clear all downloaded JPEG blobs from local cache? Ratings will remain intact.')) {
        await cacheStore.clearAllBlobs();
        this.viewportEngine.clearCache();
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

    // Sync button
    this.dom.hudSyncBtn.addEventListener('click', () => {
      this.flushSyncQueue();
    });

    // Online / Offline listeners
    window.addEventListener('online', () => {
      this.showToast('Back online! Syncing ratings...');
      this.flushSyncQueue();
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

  /**
   * Scans a Google Drive folder, performs Stem Pairing, downloads existing XMPs for ratings,
   * and saves manifest to IndexedDB.
   */
  async loadGoogleDriveFolder(folderId, folderName = 'Drive Folder') {
    this.mode = 'gdrive';
    this.showToast(`Scanning Google Drive folder: ${folderName}...`);

    try {
      const files = await driveService.listFilesInFolder(folderId, (count) => {
        this.dom.cacheProgressText.textContent = `Indexed ${count} files...`;
      });

      const photos = await this._pairFilesIntoPhotos(files, folderId, 'gdrive');
      if (photos.length === 0) {
        this.showToast('No photo pairs (.JPG / RAW) found in folder.');
        return;
      }

      this.currentShoot = {
        folderId,
        name: folderName,
        type: 'gdrive',
        count: photos.length,
        updatedAt: Date.now(),
      };

      await cacheStore.saveShoot(this.currentShoot);
      await cacheStore.savePhotos(photos);
      localStorage.setItem('darkcull_last_folder_id', folderId);

      this.allPhotos = photos;
      this.setFilter(this.activeFilter);
      this.showToast(`Loaded ${photos.length} photo pairs!`);

      // Ask to cache shoot
      this.dom.cacheProgressBar.style.display = 'flex';
      this.cacheEntireShoot();
    } catch (err) {
      console.error(err);
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
      const dirHandle = await window.showDirectoryPicker();
      this.localDirHandle = dirHandle;
      this.mode = 'local';
      const folderId = `local_${dirHandle.name}`;
      const folderName = dirHandle.name;

      this.showToast(`Reading local folder "${folderName}"...`);

      const files = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push({
            id: name, // filename as unique ID in local mode
            name: name,
            mimeType: file.type,
            size: file.size,
            modifiedTime: file.lastModified,
            handle: handle,
            fileObj: file,
          });
        }
      }

      const photos = await this._pairFilesIntoPhotos(files, folderId, 'local');
      if (photos.length === 0) {
        this.showToast('No photo pairs found in this directory.');
        return;
      }

      // Pre-cache blobs directly into IndexedDB for local mode so offline/reloads work seamlessly
      for (const p of photos) {
        const fileRecord = files.find((f) => f.name === p.jpegName);
        if (fileRecord && fileRecord.fileObj) {
          await cacheStore.saveBlob(p.jpegFileId, fileRecord.fileObj);
        }
      }

      this.currentShoot = {
        folderId,
        name: folderName,
        type: 'local',
        count: photos.length,
        updatedAt: Date.now(),
      };

      await cacheStore.saveShoot(this.currentShoot);
      await cacheStore.savePhotos(photos);
      localStorage.setItem('darkcull_last_folder_id', folderId);

      this.allPhotos = photos;
      this.setFilter(this.activeFilter);
      this.showToast(`Loaded ${photos.length} local photo pairs!`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        this.showToast(`Local folder error: ${err.message}`);
      }
    }
  }

  async loadShootFromCache(shoot) {
    this.currentShoot = shoot;
    this.mode = shoot.type || 'gdrive';
    const photos = await cacheStore.getPhotosByFolder(shoot.folderId);
    if (photos && photos.length > 0) {
      this.allPhotos = photos;
      this.setFilter('all');
      this.showToast(`Restored shoot: ${shoot.name} (${photos.length} photos)`);
    }
  }

  /**
   * Stem Pairing:
   * Groups files by basename (case-insensitive) and pairs RAW, JPEG, and XMP.
   */
  async _pairFilesIntoPhotos(files, folderId, mode) {
    // Map: lowerStem -> { stem, rawFile, jpegFile, xmpFile }
    const stemMap = new Map();

    for (const f of files) {
      const name = f.name;
      const lastDot = name.lastIndexOf('.');
      if (lastDot === -1) continue;

      let stem = name.substring(0, lastDot);
      let ext = name.substring(lastDot + 1).toUpperCase();

      // Check for double extension: P1010234.RW2.xmp
      let isXmp = ext === 'XMP';
      if (isXmp) {
        const secondDot = stem.lastIndexOf('.');
        if (secondDot !== -1) {
          const rawSubExt = stem.substring(secondDot + 1).toUpperCase();
          if (RAW_EXTS.has(rawSubExt)) {
            stem = stem.substring(0, secondDot);
          }
        }
      }

      const lowerStem = stem.toLowerCase();
      if (!stemMap.has(lowerStem)) {
        stemMap.set(lowerStem, {
          stem: stem,
          rawFile: null,
          jpegFile: null,
          xmpFile: null,
        });
      }

      const entry = stemMap.get(lowerStem);
      if (isXmp) {
        entry.xmpFile = f;
      } else if (RAW_EXTS.has(ext)) {
        entry.rawFile = f;
      } else if (JPEG_EXTS.has(ext)) {
        entry.jpegFile = f;
      }
    }

    const photos = [];

    for (const [lowerStem, entry] of stemMap.entries()) {
      // Must have at least a JPEG or a RAW file
      if (!entry.jpegFile && !entry.rawFile) continue;

      const stem = entry.stem;
      const rawName = entry.rawFile ? entry.rawFile.name : null;
      const jpegName = entry.jpegFile ? entry.jpegFile.name : null;

      // Darktable standard sidecar name
      const xmpName = XmpBuilder.determineSidecarName(rawName, jpegName);

      const photo = {
        id: `${folderId}:${stem}`,
        folderId: folderId,
        stem: stem,
        jpegFileId: entry.jpegFile ? entry.jpegFile.id : null,
        jpegName: jpegName,
        rawFileId: entry.rawFile ? entry.rawFile.id : null,
        rawName: rawName,
        xmpFileId: entry.xmpFile ? entry.xmpFile.id : null,
        xmpName: entry.xmpFile ? entry.xmpFile.name : xmpName,
        rating: 0,
        cachedBlob: false,
        syncStatus: 'synced',
      };

      // If XMP sidecar already exists on Drive or Local, parse initial rating
      if (entry.xmpFile) {
        try {
          let xmpText = '';
          if (mode === 'gdrive') {
            xmpText = await driveService.downloadText(entry.xmpFile.id);
          } else if (entry.xmpFile.fileObj) {
            xmpText = await entry.xmpFile.fileObj.text();
          }
          if (xmpText) {
            photo.rating = XmpBuilder.parseRating(xmpText);
            await cacheStore.saveXmpContent(photo.id, xmpText);
          }
        } catch (e) {
          console.warn(`Could not parse existing XMP for ${stem}:`, e);
        }
      }

      photos.push(photo);
    }

    // Sort alphabetically by stem
    photos.sort((a, b) => a.stem.localeCompare(b.stem, undefined, { numeric: true }));
    return photos;
  }

  // --- Image Blob Retrieval & Concurrency Pool Downloader ---

  async fetchPhotoBlob(photo) {
    if (!photo) return null;

    // Check IndexedDB first
    const cached = await cacheStore.getBlob(photo.jpegFileId || photo.id);
    if (cached) {
      return cached;
    }

    // If online Google Drive mode, download and cache
    if (this.mode === 'gdrive' && photo.jpegFileId) {
      try {
        const blob = await driveService.downloadBlob(photo.jpegFileId);
        await cacheStore.saveBlob(photo.jpegFileId, blob);
        photo.cachedBlob = true;
        cacheStore.updatePhoto(photo);
        return blob;
      } catch (e) {
        console.error(`Failed to download blob for ${photo.stem}:`, e);
      }
    }

    return null;
  }

  /**
   * Concurrency pool (6 workers) to cache entire shoot into IndexedDB
   */
  async cacheEntireShoot() {
    if (!this.allPhotos || this.allPhotos.length === 0) return;
    if (this.isCaching) return;
    this.isCaching = true;

    this.dom.cacheProgressBar.style.display = 'flex';
    this.dom.cacheProgressFill.style.width = '0%';

    const uncachedPhotos = [];
    for (const p of this.allPhotos) {
      const has = await cacheStore.hasBlob(p.jpegFileId || p.id);
      if (!has && p.jpegFileId) {
        uncachedPhotos.push(p);
      }
    }

    const total = this.allPhotos.length;
    let completed = total - uncachedPhotos.length;

    const updateProgress = () => {
      const pct = Math.round((completed / total) * 100);
      this.dom.cacheProgressFill.style.width = `${pct}%`;
      this.dom.cacheProgressText.textContent = `Caching JPEGs: ${completed} / ${total} (${pct}%)`;
    };

    updateProgress();

    if (uncachedPhotos.length === 0) {
      this.isCaching = false;
      this.dom.cacheProgressText.textContent = `All ${total} photos cached locally!`;
      setTimeout(() => {
        this.dom.cacheProgressBar.style.display = 'none';
      }, 3000);
      return;
    }

    // Concurrency pool of 6 workers
    const concurrency = 6;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < uncachedPhotos.length) {
        const photo = uncachedPhotos[nextIndex++];
        try {
          if (this.mode === 'gdrive') {
            const blob = await driveService.downloadBlob(photo.jpegFileId);
            await cacheStore.saveBlob(photo.jpegFileId, blob);
            photo.cachedBlob = true;
            cacheStore.updatePhoto(photo);
          }
        } catch (err) {
          console.warn(`Worker failed to download ${photo.stem}:`, err);
        } finally {
          completed++;
          updateProgress();
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, uncachedPhotos.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    this.isCaching = false;
    this.dom.cacheProgressText.textContent = `Finished caching ${total} JPEGs! (0ms Scrubbing Ready)`;
    await this._updateStorageStatus();
    setTimeout(() => {
      this.dom.cacheProgressBar.style.display = 'none';
    }, 4000);
  }

  // --- Filtering & View State ---

  setFilter(filterType) {
    this.activeFilter = filterType;
    this._applyFilter();
    this.updateTallies();
  }

  _applyFilter() {
    if (this.activeFilter === 'all') {
      this.filteredPhotos = [...this.allPhotos];
    } else if (this.activeFilter === 'unrated') {
      this.filteredPhotos = this.allPhotos.filter((p) => p.rating === 0);
    } else if (this.activeFilter === '3+') {
      this.filteredPhotos = this.allPhotos.filter((p) => p.rating >= 3);
    } else if (this.activeFilter === '4+') {
      this.filteredPhotos = this.allPhotos.filter((p) => p.rating >= 4);
    } else if (this.activeFilter === '5') {
      this.filteredPhotos = this.allPhotos.filter((p) => p.rating === 5);
    } else if (this.activeFilter === 'rejected') {
      this.filteredPhotos = this.allPhotos.filter((p) => p.rating === -1);
    }

    this.viewportEngine.setPhotos(this.filteredPhotos);

    if (this.filteredPhotos.length === 0) {
      this.currentIndex = -1;
      this.dom.emptyState.style.display = 'flex';
      this.dom.mainImg.style.display = 'none';
      this.updateHud();
    } else {
      this.dom.emptyState.style.display = 'none';
      this.dom.mainImg.style.display = 'block';
      this.currentIndex = 0;
      this.renderCurrentPhoto();
    }
  }

  updateTallies() {
    let unrated = 0;
    let r3Plus = 0;
    let r4Plus = 0;
    let r5 = 0;
    let rejected = 0;

    for (const p of this.allPhotos) {
      if (p.rating === 0) unrated++;
      else if (p.rating === -1) rejected++;
      else {
        if (p.rating >= 3) r3Plus++;
        if (p.rating >= 4) r4Plus++;
        if (p.rating === 5) r5++;
      }
    }

    this.dom.tallyTotal.textContent = this.allPhotos.length;
    this.dom.tally3Plus.textContent = r3Plus;
    this.dom.tally4Plus.textContent = r4Plus;
    this.dom.tally5.textContent = r5;
    this.dom.tallyRejected.textContent = rejected;
  }

  updateHud() {
    if (this.currentIndex < 0 || this.filteredPhotos.length === 0) {
      this.dom.hudFilename.textContent = 'No photos';
      this.dom.hudIndex.textContent = '0 / 0';
      this.dom.hudStarBadge.textContent = '★ -';
      this.dom.hudStarBadge.className = 'hud-badge badge-unrated';
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
    } else if (photo.rating === 0) {
      badge.textContent = '★ 0';
      badge.className = 'hud-badge badge-unrated';
    } else {
      badge.textContent = `★ ${photo.rating}`;
      badge.className = `hud-badge badge-rated rate-${photo.rating}`;
    }

    // Highlight active rating button on bottom dock
    const ratingButtons = [
      this.dom.btnReject,
      this.dom.btnRate0,
      this.dom.btnRate1,
      this.dom.btnRate2,
      this.dom.btnRate3,
      this.dom.btnRate4,
      this.dom.btnRate5,
    ];
    ratingButtons.forEach((btn) => {
      if (btn) btn.classList.remove('btn-active');
    });

    if (photo.rating === -1) {
      this.dom.btnReject.classList.add('btn-active');
    } else if (photo.rating === 0) {
      this.dom.btnRate0.classList.add('btn-active');
    } else {
      const btn = this.dom[`btnRate${photo.rating}`];
      if (btn) btn.classList.add('btn-active');
    }
  }

  renderCurrentPhoto() {
    if (this.currentIndex < 0 || this.currentIndex >= this.filteredPhotos.length) return;
    this.updateHud();
    this.viewportEngine.showPhoto(this.currentIndex);
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

  // --- Rating & Non-Destructive XMP Background Sync ---

  async setRating(rating) {
    if (this.filteredPhotos.length === 0 || this.currentIndex < 0) return;
    const photo = this.filteredPhotos[this.currentIndex];
    if (photo.rating === rating) {
      if (this.autoAdvance) this.nextPhoto();
      return;
    }

    // 1. Instantly update UI and memory (<16ms)
    photo.rating = rating;
    photo.syncStatus = 'dirty';
    this.updateHud();
    this.updateTallies();

    // 2. Persist to IndexedDB
    await cacheStore.updatePhoto(photo);

    // 3. Enqueue to background sync queue
    const syncItem = {
      id: photo.id,
      folderId: photo.folderId,
      stem: photo.stem,
      rating: rating,
      timestamp: Date.now(),
      mode: this.mode,
      photoData: { ...photo },
    };
    await cacheStore.enqueueSyncItem(syncItem);
    this.updateSyncBadge();

    // 4. Advance to next photo if auto-advance is on
    if (this.autoAdvance) {
      this.nextPhoto();
    }

    // 5. Trigger background sync processor non-blockingly
    this.flushSyncQueue();
  }

  async _checkOfflineQueue() {
    await this.updateSyncBadge();
    if (navigator.onLine) {
      this.flushSyncQueue();
    }
  }

  async updateSyncBadge() {
    const queue = await cacheStore.getPendingSyncItems();
    const count = queue.length;

    if (count === 0) {
      this.dom.hudSyncBadge.textContent = 'Synced';
      this.dom.hudSyncBadge.className = 'hud-badge badge-synced';
      this.dom.hudSyncBtn.style.display = 'none';
    } else {
      this.dom.hudSyncBadge.textContent = `Syncing ${count} XMPs...`;
      this.dom.hudSyncBadge.className = 'hud-badge badge-syncing';
      this.dom.hudSyncBtn.style.display = 'inline-block';
    }
  }

  /**
   * Background processor: Non-blockingly syncs dirty XMPs to Drive or local filesystem
   */
  async flushSyncQueue() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const queue = await cacheStore.getPendingSyncItems();
      if (queue.length === 0) {
        this.updateSyncBadge();
        this.isSyncing = false;
        return;
      }

      for (const item of queue) {
        try {
          const photo = item.photoData;

          // Retrieve cached original XMP if it exists
          let cachedXml = await cacheStore.getXmpContent(item.id);
          let newXml = '';

          if (cachedXml) {
            // Non-destructively patch existing XML
            newXml = XmpBuilder.patchRating(cachedXml, item.rating);
          } else {
            // Generate clean minimal darktable XMP
            newXml = XmpBuilder.generateMinimalXmp(item.rating);
          }

          if (item.mode === 'gdrive') {
            if (photo.xmpFileId) {
              // PATCH existing file
              await driveService.updateXmpFile(photo.xmpFileId, newXml);
            } else {
              // POST new file
              const res = await driveService.createXmpFile(photo.folderId, photo.xmpName, newXml);
              photo.xmpFileId = res.id;
              await cacheStore.updatePhoto(photo);
            }
          } else if (item.mode === 'local' && this.localDirHandle) {
            // Write directly to local folder sidecar file
            const fileHandle = await this.localDirHandle.getFileHandle(photo.xmpName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(newXml);
            await writable.close();
          }

          // Update cached XMP content and remove from queue
          await cacheStore.saveXmpContent(item.id, newXml);
          await cacheStore.removeSyncItem(item.id);

          photo.syncStatus = 'synced';
          await cacheStore.updatePhoto(photo);
        } catch (err) {
          console.error(`Sync error on photo ${item.stem}:`, err);
          // If auth error or offline, break loop to retry later
          if (!navigator.onLine) break;
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
