import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment } from './testHelper.js';
import { CacheStore } from '../js/cacheStore.js';

describe('CacheStore (IndexedDB)', () => {
  let cache;

  beforeEach(() => {
    setupTestEnvironment();
    cache = new CacheStore();
  });

  describe('Shoots store', () => {
    it('saves, retrieves, and lists shoots', async () => {
      const shoot1 = { folderId: 'folder_A', name: 'Shoot A', type: 'gdrive', count: 120, updatedAt: 1000 };
      const shoot2 = { folderId: 'folder_B', name: 'Shoot B', type: 'local', count: 45, updatedAt: 2000 };

      await cache.saveShoot(shoot1);
      await cache.saveShoot(shoot2);

      const retrievedA = await cache.getShoot('folder_A');
      assert.deepEqual(retrievedA, shoot1);

      const allShoots = await cache.getAllShoots();
      assert.equal(allShoots.length, 2);
    });
  });

  describe('Photos store', () => {
    it('saves batch photos, queries by folderId index, and updates photos', async () => {
      const photos = [
        { id: 'f1:p1', folderId: 'f1', stem: 'IMG_01', rating: 0, syncStatus: 'synced' },
        { id: 'f1:p2', folderId: 'f1', stem: 'IMG_02', rating: 5, syncStatus: 'synced' },
        { id: 'f2:p3', folderId: 'f2', stem: 'IMG_03', rating: -1, syncStatus: 'synced' },
      ];

      await cache.savePhotos(photos);

      const f1Photos = await cache.getPhotosByFolder('f1');
      assert.equal(f1Photos.length, 2);
      assert.equal(f1Photos[0].stem, 'IMG_01');
      assert.equal(f1Photos[1].stem, 'IMG_02');

      const single = await cache.getPhoto('f1:p2');
      assert.equal(single.rating, 5);

      // Update single photo
      single.rating = 4;
      single.syncStatus = 'dirty';
      await cache.updatePhoto(single);

      const updated = await cache.getPhoto('f1:p2');
      assert.equal(updated.rating, 4);
      assert.equal(updated.syncStatus, 'dirty');
    });
  });

  describe('Blobs store (binary images)', () => {
    it('saves, checks, gets, and lists blob keys in bulk', async () => {
      const blob1 = new Blob(['fake jpeg bytes 1'], { type: 'image/jpeg' });
      const blob2 = new Blob(['fake jpeg bytes 2'], { type: 'image/jpeg' });

      await cache.saveBlob('blob_key_1', blob1);
      await cache.saveBlob('blob_key_2', blob2);

      assert.equal(await cache.hasBlob('blob_key_1'), true);
      assert.equal(await cache.hasBlob('blob_key_nonexistent'), false);

      const retrieved = await cache.getBlob('blob_key_1');
      assert.ok(retrieved);
      assert.equal(await retrieved.text(), 'fake jpeg bytes 1');

      const keysSet = await cache.getBlobKeys();
      assert.ok(keysSet instanceof Set);
      assert.equal(keysSet.size, 2);
      assert.ok(keysSet.has('blob_key_1'));
      assert.ok(keysSet.has('blob_key_2'));

      await cache.clearAllBlobs();
      const keysAfterClear = await cache.getBlobKeys();
      assert.equal(keysAfterClear.size, 0);
    });
  });

  describe('XMPs store', () => {
    it('saves and retrieves sidecar XML text', async () => {
      const xml = '<x:xmpmeta>test</x:xmpmeta>';
      await cache.saveXmpContent('photo_123', xml);

      const retrieved = await cache.getXmpContent('photo_123');
      assert.equal(retrieved, xml);

      const nonExistent = await cache.getXmpContent('unknown_photo');
      assert.equal(nonExistent, null);
    });
  });

  describe('SyncQueue store', () => {
    it('enqueues, retrieves by folder, gets single, and dequeues sync items', async () => {
      const item1 = { id: 'f1:photo1', folderId: 'f1', stem: 'photo1', rating: 5, timestamp: 100 };
      const item2 = { id: 'f1:photo2', folderId: 'f1', stem: 'photo2', rating: -1, timestamp: 200 };
      const item3 = { id: 'f2:photo3', folderId: 'f2', stem: 'photo3', rating: 3, timestamp: 300 };

      await cache.enqueueSyncItem(item1);
      await cache.enqueueSyncItem(item2);
      await cache.enqueueSyncItem(item3);

      const allQueue = await cache.getPendingSyncItems();
      assert.equal(allQueue.length, 3);

      const f1Queue = await cache.getPendingSyncItems('f1');
      assert.equal(f1Queue.length, 2);

      const single = await cache.getSyncItem('f1:photo1');
      assert.equal(single.rating, 5);

      await cache.removeSyncItem('f1:photo1');
      const afterRemove = await cache.getSyncItem('f1:photo1');
      assert.equal(afterRemove, null);

      const remainingF1 = await cache.getPendingSyncItems('f1');
      assert.equal(remainingF1.length, 1);
      assert.equal(remainingF1[0].id, 'f1:photo2');
    });
  });

  describe('wipeAllData & storageUsage', () => {
    it('clears all stores across the entire database', async () => {
      await cache.saveShoot({ folderId: 'f1', name: 'Shoot 1' });
      await cache.savePhotos([{ id: 'p1', folderId: 'f1', stem: 'IMG_1' }]);
      await cache.saveBlob('b1', new Blob(['test']));
      await cache.saveXmpContent('p1', '<xml/>');
      await cache.enqueueSyncItem({ id: 'p1', folderId: 'f1', rating: 4 });

      await cache.wipeAllData();

      assert.equal((await cache.getAllShoots()).length, 0);
      assert.equal((await cache.getPhotosByFolder('f1')).length, 0);
      assert.equal((await cache.getBlobKeys()).size, 0);
      assert.equal(await cache.getXmpContent('p1'), null);
      assert.equal((await cache.getPendingSyncItems()).length, 0);
    });

    it('retrieves storage estimate', async () => {
      const usage = await cache.getStorageUsage();
      assert.ok(usage);
      assert.equal(typeof usage.usage, 'number');
      assert.equal(typeof usage.quota, 'number');
    });
  });
});
