import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, MockElement } from './testHelper.js';
import { APP_VERSION } from '../js/app.js';
import { cacheStore } from '../js/cacheStore.js';

describe('DarkCullApp Core Logic', () => {
  let app;
  let dom;

  beforeEach(() => {
    setupTestEnvironment();

    dom = {
      hudInfoPill: new MockElement('div', 'hudInfoPill'),
      hudSyncDot: new MockElement('span', 'hudSyncDot'),
      hudSyncBtn: new MockElement('button', 'hudSyncBtn'),
      hudFilename: new MockElement('span', 'hudFilename'),
      hudFormatBadge: new MockElement('span', 'hudFormatBadge'),
      hudBurstBadge: new MockElement('span', 'hudBurstBadge'),
      hudIndex: new MockElement('span', 'hudIndex'),
      hudExifPill: new MockElement('div', 'hudExifPill'),
      exifText: new MockElement('span', 'exifText'),
      cacheProgressBar: new MockElement('div', 'cacheProgressBar'),
      cacheProgressText: new MockElement('div', 'cacheProgressText'),
      cacheProgressFill: new MockElement('div', 'cacheProgressFill'),
      scrubPreview: new MockElement('div', 'scrubPreview'),
      scrubThumbImg: new MockElement('img', 'scrubThumbImg'),
      scrubThumbPlaceholder: new MockElement('div', 'scrubThumbPlaceholder'),
      scrubPreviewIndex: new MockElement('span', 'scrubPreviewIndex'),
      scrubPreviewName: new MockElement('span', 'scrubPreviewName'),
      scrubPreviewBurst: new MockElement('span', 'scrubPreviewBurst'),
      scrubPreviewFill: new MockElement('div', 'scrubPreviewFill'),
      tallyTotal: new MockElement('strong', 'tallyTotal'),
      tallyUnrated: new MockElement('strong', 'tallyUnrated'),
      tally3: new MockElement('strong', 'tally3'),
      tally4: new MockElement('strong', 'tally4'),
      tally5: new MockElement('strong', 'tally5'),
      tallyRejected: new MockElement('strong', 'tallyRejected'),
      filterCountNotRejected: new MockElement('span', 'filterCountNotRejected'),
      filterCountUnrated: new MockElement('span', 'filterCountUnrated'),
      filterCount3: new MockElement('span', 'filterCount3'),
      filterCount4: new MockElement('span', 'filterCount4'),
      filterCount5: new MockElement('span', 'filterCount5'),
      filterCountRejected: new MockElement('span', 'filterCountRejected'),
      filterCountAll: new MockElement('span', 'filterCountAll'),
      filterPills: [],
      viewport: new MockElement('div', 'viewport'),
      mainImg: new MockElement('img', 'mainImg'),
      emptyState: new MockElement('div', 'emptyState'),
      rawNotice: new MockElement('div', 'rawNotice'),
      rawNoticeFilename: new MockElement('span', 'rawNoticeFilename'),
      loupeIndicator: new MockElement('div', 'loupeIndicator'),
      swipeBadge: new MockElement('div', 'swipeBadge'),
      loadingSpinner: new MockElement('div', 'loadingSpinner'),
      dockStatusPill: new MockElement('div', 'dockStatusPill'),
      toast: new MockElement('div', 'toast'),
    };

    // Instantiate app prototype or mock instance to test business logic methods
    app = {
      dom,
      mode: 'gdrive',
      currentShoot: { folderId: 'test_folder', name: 'Test Shoot' },
      allPhotos: [],
      filteredPhotos: [],
      activeFilter: 'not-rejected',
      currentIndex: -1,
      _anchorPhoto: null,
      autoAdvance: true,
      undoStack: [],
      isSyncing: false,
      loadToken: 1,
      xmpSources: new Map(),
      localFiles: new Map(),
      viewportEngine: {
        setPhotos: (p) => {},
        showPhoto: (i) => {},
        reindex: (i) => {},
        preloaded: new Map(),
      },
      showToast: (m) => {},
      _saveProgress: () => {},
    };

    // Bind prototype methods from DarkCullApp definition
    app._pairFilesIntoPhotos = function (files, folderId) {
      const RAW_EXTS = new Set([
        'RW2', 'ORF', 'DNG', 'ARW', 'CR2', 'CR3', 'NEF', 'RAF',
        'GPR', 'PEF', '3FR', 'FFF', 'X3F', 'SRW', 'CRW'
      ]);
      const JPEG_EXTS = new Set(['JPG', 'JPEG', 'JPE', 'JFIF']);

      const stemMap = new Map();
      for (const f of files) {
        const name = (f.name || '').trim();
        const lastDot = name.lastIndexOf('.');
        if (lastDot === -1) continue;

        let stem = name.substring(0, lastDot).trim();
        const ext = name.substring(lastDot + 1).toUpperCase();

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
          const isDtStyle = stem !== name.substring(0, lastDot);
          if (!entry.xmpFile || isDtStyle) entry.xmpFile = f;
        } else if (RAW_EXTS.has(ext)) {
          entry.rawFile = f;
        } else if (JPEG_EXTS.has(ext)) {
          entry.jpegFile = f;
        }
      }

      // Secondary pass: Pair unpaired RAW and JPEG files sharing numeric sequence
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
              r.entry.jpegFile = j.entry.jpegFile;
              if (j.entry.xmpFile && !r.entry.xmpFile) {
                r.entry.xmpFile = j.entry.xmpFile;
              }
              stemMap.delete(j.key);
              candidates.length = 0;
            }
          }
        }
      }

      const photos = [];
      for (const entry of stemMap.values()) {
        if (!entry.jpegFile && !entry.rawFile) continue;
        const stem = entry.stem;
        photos.push({
          id: `${folderId}:${stem}`,
          folderId,
          stem,
          jpegFileId: entry.jpegFile ? entry.jpegFile.id : null,
          jpegName: entry.jpegFile ? entry.jpegFile.name : null,
          rawFileId: entry.rawFile ? entry.rawFile.id : null,
          rawName: entry.rawFile ? entry.rawFile.name : null,
          xmpFileId: entry.xmpFile ? entry.xmpFile.id : null,
          rating: 0,
          captureTimeMs: null,
          burstIndex: 0,
          burstTotal: 0,
        });
      }

      photos.sort((a, b) => a.stem.localeCompare(b.stem, undefined, { numeric: true }));
      this._computeBursts(photos);
      return photos;
    };

    app._computeBursts = function (photos = this.allPhotos) {
      if (!photos || photos.length === 0) return;
      const getTs = (p) => {
        if (typeof p.captureTimeMs === 'number' && !Number.isNaN(p.captureTimeMs)) return p.captureTimeMs;
        if (p.exif && typeof p.exif.timestampMs === 'number' && !Number.isNaN(p.exif.timestampMs)) return p.exif.timestampMs;
        return null;
      };

      const BURST_THRESHOLD_MS = 1500;
      let runStart = 0;

      const commitRun = (start, endExclusive) => {
        const len = endExclusive - start;
        for (let idx = start; idx < endExclusive; idx++) {
          if (len >= 2) {
            photos[idx].burstIndex = idx - start + 1;
            photos[idx].burstTotal = len;
          } else {
            photos[idx].burstIndex = 0;
            photos[idx].burstTotal = 0;
          }
        }
      };

      for (let i = 1; i <= photos.length; i++) {
        if (i === photos.length) {
          commitRun(runStart, i);
          break;
        }
        const prevTs = getTs(photos[i - 1]);
        const curTs = getTs(photos[i]);
        const delta = prevTs !== null && curTs !== null ? Math.abs(curTs - prevTs) : Infinity;

        if (delta <= BURST_THRESHOLD_MS) {
          continue;
        } else {
          commitRun(runStart, i);
          runStart = i;
        }
      }
    };

    app._matchesActiveFilter = function (photo) {
      const r = photo.rating || 0;
      if (this.activeFilter === 'not-rejected') return r !== -1;
      if (this.activeFilter === 'unrated') return r === 0 || r === 1 || r === 2;
      if (this.activeFilter === '3') return r === 3;
      if (this.activeFilter === '4') return r === 4;
      if (this.activeFilter === '5') return r === 5;
      if (this.activeFilter === 'rejected') return r === -1;
      return true; // 'all'
    };

    app.updateTallies = function () {
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

      this.dom.tallyTotal.textContent = this.allPhotos.length;
      this.dom.tallyUnrated.textContent = unrated;
      this.dom.tally3.textContent = r3;
      this.dom.tally4.textContent = r4;
      this.dom.tally5.textContent = r5;
      this.dom.tallyRejected.textContent = rejected;
    };
  });

  describe('Stem Pairing (_pairFilesIntoPhotos)', () => {
    it('pairs companion RAW and JPEG files with matching basename', () => {
      const files = [
        { id: '1', name: 'IMG_1001.JPG' },
        { id: '2', name: 'IMG_1001.CR3' },
        { id: '3', name: 'IMG_1002.JPG' },
        { id: '4', name: 'IMG_1002.CR3' },
      ];

      const photos = app._pairFilesIntoPhotos(files, 'test_folder');
      assert.equal(photos.length, 2);
      assert.equal(photos[0].stem, 'IMG_1001');
      assert.equal(photos[0].jpegName, 'IMG_1001.JPG');
      assert.equal(photos[0].rawName, 'IMG_1001.CR3');
      assert.equal(photos[1].stem, 'IMG_1002');
    });

    it('handles darktable double-extension sidecars (P101001.RW2.xmp)', () => {
      const files = [
        { id: '1', name: 'P101001.JPG' },
        { id: '2', name: 'P101001.RW2' },
        { id: '3', name: 'P101001.RW2.xmp' },
      ];

      const photos = app._pairFilesIntoPhotos(files, 'test_folder');
      assert.equal(photos.length, 1);
      assert.equal(photos[0].stem, 'P101001');
      assert.equal(photos[0].xmpFileId, '3');
    });

    it('pairs mismatched prefix files sharing exact numeric sequence (e.g. Panasonic/Olympus AdobeRGB _1010234 vs sRGB P1010234)', () => {
      const files = [
        { id: '1', name: '_1010234.ORF' },
        { id: '2', name: 'P1010234.JPG' },
      ];

      const photos = app._pairFilesIntoPhotos(files, 'test_folder');
      assert.equal(photos.length, 1);
      assert.equal(photos[0].rawName, '_1010234.ORF');
      assert.equal(photos[0].jpegName, 'P1010234.JPG');
    });

    it('correctly handles RAW-only and JPEG-only single files', () => {
      const files = [
        { id: '1', name: 'SOLO_RAW.DNG' },
        { id: '2', name: 'SOLO_JPEG.JPG' },
      ];

      const photos = app._pairFilesIntoPhotos(files, 'test_folder');
      assert.equal(photos.length, 2);
      assert.equal(photos[0].rawName, null);
      assert.equal(photos[0].jpegName, 'SOLO_JPEG.JPG');
      assert.equal(photos[1].rawName, 'SOLO_RAW.DNG');
      assert.equal(photos[1].jpegName, null);
    });

    it('sorts photos naturally by numeric stem', () => {
      const files = [
        { id: '1', name: 'photo-10.JPG' },
        { id: '2', name: 'photo-2.JPG' },
        { id: '3', name: 'photo-1.JPG' },
      ];

      const photos = app._pairFilesIntoPhotos(files, 'test_folder');
      assert.deepEqual(
        photos.map((p) => p.stem),
        ['photo-1', 'photo-2', 'photo-10']
      );
    });
  });

  describe('Burst Detection (_computeBursts)', () => {
    it('groups shots within 1.5s (1500ms) delta into burst sequence', () => {
      const base = 1690000000000;
      const photos = [
        { id: '1', stem: 'p1', captureTimeMs: base },
        { id: '2', stem: 'p2', captureTimeMs: base + 300 }, // +0.3s -> burst
        { id: '3', stem: 'p3', captureTimeMs: base + 700 }, // +0.4s -> burst
        { id: '4', stem: 'p4', captureTimeMs: base + 6000 }, // +5.3s -> break / single
        { id: '5', stem: 'p5', captureTimeMs: base + 6200 }, // burst 2
        { id: '6', stem: 'p6', captureTimeMs: base + 6500 }, // burst 2
      ];

      app._computeBursts(photos);

      // First burst: 3 photos
      assert.equal(photos[0].burstIndex, 1);
      assert.equal(photos[0].burstTotal, 3);
      assert.equal(photos[1].burstIndex, 2);
      assert.equal(photos[1].burstTotal, 3);
      assert.equal(photos[2].burstIndex, 3);
      assert.equal(photos[2].burstTotal, 3);

      // Single photo (gap was 5.3s from p3, but wait: is p4 within 1.5s of p5? p5 - p4 = 200ms!)
      // Since p5 - p4 is 200ms, p4, p5, p6 form a second burst of 3!
      assert.equal(photos[3].burstIndex, 1);
      assert.equal(photos[3].burstTotal, 3);
      assert.equal(photos[4].burstIndex, 2);
      assert.equal(photos[4].burstTotal, 3);
      assert.equal(photos[5].burstIndex, 3);
      assert.equal(photos[5].burstTotal, 3);
    });

    it('sets burstIndex = 0 and burstTotal = 0 for isolated single shots', () => {
      const base = 1690000000000;
      const photos = [
        { id: '1', stem: 'p1', captureTimeMs: base },
        { id: '2', stem: 'p2', captureTimeMs: base + 10000 }, // 10s gap
        { id: '3', stem: 'p3', captureTimeMs: base + 20000 }, // 10s gap
      ];

      app._computeBursts(photos);

      for (const p of photos) {
        assert.equal(p.burstIndex, 0);
        assert.equal(p.burstTotal, 0);
      }
    });

    it('handles null timestamps safely without throwing', () => {
      const photos = [
        { id: '1', stem: 'p1', captureTimeMs: null },
        { id: '2', stem: 'p2', captureTimeMs: null },
      ];

      assert.doesNotThrow(() => app._computeBursts(photos));
      assert.equal(photos[0].burstTotal, 0);
    });
  });

  describe('Filtering & Tallies', () => {
    it('_matchesActiveFilter filters correctly for each mode', () => {
      const unrated = { rating: 0 };
      const star3 = { rating: 3 };
      const star4 = { rating: 4 };
      const star5 = { rating: 5 };
      const rejected = { rating: -1 };

      // not-rejected (Keep)
      app.activeFilter = 'not-rejected';
      assert.equal(app._matchesActiveFilter(unrated), true);
      assert.equal(app._matchesActiveFilter(star3), true);
      assert.equal(app._matchesActiveFilter(rejected), false);

      // unrated
      app.activeFilter = 'unrated';
      assert.equal(app._matchesActiveFilter(unrated), true);
      assert.equal(app._matchesActiveFilter(star3), false);

      // stars
      app.activeFilter = '3';
      assert.equal(app._matchesActiveFilter(star3), true);
      assert.equal(app._matchesActiveFilter(star4), false);

      app.activeFilter = '5';
      assert.equal(app._matchesActiveFilter(star5), true);
      assert.equal(app._matchesActiveFilter(star3), false);

      // rejected
      app.activeFilter = 'rejected';
      assert.equal(app._matchesActiveFilter(rejected), true);
      assert.equal(app._matchesActiveFilter(unrated), false);

      // all
      app.activeFilter = 'all';
      assert.equal(app._matchesActiveFilter(rejected), true);
      assert.equal(app._matchesActiveFilter(unrated), true);
      assert.equal(app._matchesActiveFilter(star5), true);
    });

    it('updateTallies accurately aggregates all rating categories', () => {
      app.allPhotos = [
        { rating: 0 },
        { rating: 0 },
        { rating: 3 },
        { rating: 4 },
        { rating: 4 },
        { rating: 5 },
        { rating: -1 },
        { rating: -1 },
      ];

      app.updateTallies();

      assert.equal(dom.tallyTotal.textContent, '8');
      assert.equal(dom.tallyUnrated.textContent, '2');
      assert.equal(dom.tally3.textContent, '1');
      assert.equal(dom.tally4.textContent, '2');
      assert.equal(dom.tally5.textContent, '1');
      assert.equal(dom.tallyRejected.textContent, '2');
    });
  });

  describe('Undo Stack functionality', () => {
    it('pushes and pops rating actions in undo stack', () => {
      const action = {
        type: 'rate',
        photoId: 'photo_1',
        prevRating: 0,
        newRating: 5,
      };

      app.undoStack.push(action);
      assert.equal(app.undoStack.length, 1);

      const popped = app.undoStack.pop();
      assert.deepEqual(popped, action);
      assert.equal(app.undoStack.length, 0);
    });

    it('limits undo stack history to 50 actions', () => {
      for (let i = 0; i < 60; i++) {
        app.undoStack.push({ type: 'nav', navLabel: 'next', photoId: `p_${i}` });
        if (app.undoStack.length > 50) app.undoStack.shift();
      }
      assert.equal(app.undoStack.length, 50);
      assert.equal(app.undoStack[0].photoId, 'p_10');
      assert.equal(app.undoStack[49].photoId, 'p_59');
    });
  });

  describe('Application Version', () => {
    it('exports version matching current release', () => {
      assert.equal(APP_VERSION, '1.6');
    });
  });
});
