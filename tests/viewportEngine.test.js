import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, MockElement } from './testHelper.js';
import { ViewportEngine } from '../js/viewportEngine.js';

describe('ViewportEngine', () => {
  let container;
  let imgElement;
  let loupeBadge;
  let rawNotice;
  let rawNoticeFilename;
  let engine;
  let photos;
  let blobs;

  beforeEach(() => {
    setupTestEnvironment();

    container = new MockElement('div', 'viewport');
    imgElement = new MockElement('img', 'mainImg');
    imgElement.naturalWidth = 1920;
    imgElement.naturalHeight = 1080;
    imgElement.width = 1920;
    imgElement.height = 1080;
    loupeBadge = new MockElement('div', 'loupeIndicator');
    rawNotice = new MockElement('div', 'rawNotice');
    rawNoticeFilename = new MockElement('span', 'rawNoticeFilename');

    photos = [
      { id: 'p0', stem: 'IMG_00', jpegFileId: 'blob_0' },
      { id: 'p1', stem: 'IMG_01', jpegFileId: 'blob_1' },
      { id: 'p2', stem: 'IMG_02', jpegFileId: 'blob_2' },
      { id: 'p3', stem: 'IMG_03', jpegFileId: 'blob_3' },
      { id: 'p4', stem: 'IMG_04', jpegFileId: 'blob_4' },
      { id: 'p5', stem: 'IMG_05', jpegFileId: 'blob_5' },
      { id: 'p6_raw', stem: 'IMG_06_RAW', jpegFileId: null, rawFileId: 'raw_6' },
    ];

    blobs = new Map([
      ['blob_0', new Blob(['jpg0'])],
      ['blob_1', new Blob(['jpg1'])],
      ['blob_2', new Blob(['jpg2'])],
      ['blob_3', new Blob(['jpg3'])],
      ['blob_4', new Blob(['jpg4'])],
      ['blob_5', new Blob(['jpg5'])],
    ]);

    engine = new ViewportEngine({
      container,
      imgElement,
      loupeBadge,
      rawNotice,
      rawNoticeFilename,
      getBlobFn: async (photo) => blobs.get(photo.jpegFileId) || null,
      maxZoomScale: 3.0,
      windowBefore: 1,
      windowAfter: 2,
    });
    engine.setPhotos(photos);
  });

  describe('Sliding window preloading & ObjectURL lifecycle', () => {
    it('preloads active photo and sliding window neighbors', async () => {
      // Display photo index 2 (window covers index 1..4: p1, p2, p3, p4)
      await engine.showPhoto(2);

      assert.equal(engine.currentIndex, 2);
      assert.ok(imgElement.src.startsWith('blob:test-app/'));

      // Check preloaded window
      assert.ok(engine.preloaded.has('p2'), 'Active photo p2 must be preloaded');
      assert.ok(engine.preloaded.has('p1'), 'p1 within windowBefore must be preloaded');
      assert.ok(engine.preloaded.has('p3'), 'p3 within windowAfter must be preloaded');
      assert.ok(engine.preloaded.has('p4'), 'p4 within windowAfter must be preloaded');
      assert.equal(engine.preloaded.has('p0'), false, 'p0 is outside window and should not be preloaded');
    });

    it('evicts out-of-window photos and revokes their ObjectURLs as the user culled forward', async () => {
      // First view p1 (window 0..3)
      await engine.showPhoto(1);
      assert.ok(engine.preloaded.has('p0'));

      const p0Url = engine.preloaded.get('p0').url;
      assert.ok(URL._getStore().has(p0Url));

      // Jump forward to p4 (window 3..6). p0 is now far out of window.
      await engine.showPhoto(4);

      assert.equal(engine.preloaded.has('p0'), false, 'p0 must be evicted from preloaded map');
      assert.equal(URL._getStore().has(p0Url), false, 'p0 ObjectURL must be revoked to free memory');
    });

    it('clearCache() revokes all active ObjectURLs and empties preloaded map', async () => {
      await engine.showPhoto(1);
      const activeUrls = Array.from(engine.preloaded.values()).map((v) => v.url);
      assert.ok(activeUrls.length > 0);

      engine.clearCache();
      assert.equal(engine.preloaded.size, 0);
      for (const u of activeUrls) {
        assert.equal(URL._getStore().has(u), false);
      }
    });

    it('displays rawNotice for RAW-only photo without companion JPEG', async () => {
      await engine.showPhoto(6); // p6_raw
      assert.equal(imgElement.style.display, 'none');
      assert.equal(rawNotice.style.display, 'flex');
      assert.equal(rawNoticeFilename.textContent, 'IMG_06_RAW');
    });
  });

  describe('Pinch & Zoom geometry mathematics', () => {
    it('calculates touch distance with Pythagorean theorem', () => {
      const t1 = { clientX: 0, clientY: 0 };
      const t2 = { clientX: 30, clientY: 40 };
      const dist = engine._getTouchDistance(t1, t2);
      assert.equal(dist, 50); // 3-4-5 triangle
    });

    it('calculates touch midpoint correctly', () => {
      const t1 = { clientX: 10, clientY: 20 };
      const t2 = { clientX: 50, clientY: 80 };
      const mid = engine._getTouchMidpoint(t1, t2);
      assert.deepEqual(mid, { x: 30, y: 50 });
    });

    it('clamps zoom scales between 1.0 and maxZoomScale (3.0)', () => {
      // Zoom in
      engine.zoomToScale(2.5, 400, 300);
      assert.equal(engine.isZoomed, true);
      assert.equal(engine.zoomScale, 2.5);

      // Attempt zoom beyond max (e.g. 5.0) -> clamps to 3.0
      engine.zoomToScale(5.0, 400, 300);
      assert.equal(engine.zoomScale, 3.0);

      // Reset zoom
      engine.resetZoom();
      assert.equal(engine.isZoomed, false);
      assert.equal(engine.zoomScale, 1.0);
      assert.equal(engine.panX, 0);
      assert.equal(engine.panY, 0);
    });

    it('toggleZoom switches between 1x and 2.5x', () => {
      assert.equal(engine.isZoomed, false);
      engine.toggleZoom(400, 300);
      assert.equal(engine.isZoomed, true);
      assert.equal(engine.zoomScale, 2.5);

      engine.toggleZoom(400, 300);
      assert.equal(engine.isZoomed, false);
      assert.equal(engine.zoomScale, 1.0);
    });
  });
});
