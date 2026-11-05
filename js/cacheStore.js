/**
 * IndexedDB storage engine for DarkCull
 * Stores shoots, photos, raw JPEG blobs, original XMP content, and the dirty sync queue.
 */

const DB_NAME = 'DarkCullDB';
const DB_VERSION = 1;

export class CacheStore {
  constructor() {
    this.db = null;
    this.initPromise = this._init();
  }

  async _init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. shoots store (metadata for indexed folders)
        if (!db.objectStoreNames.contains('shoots')) {
          db.createObjectStore('shoots', { keyPath: 'folderId' });
        }

        // 2. photos store (PhotoItem state records)
        if (!db.objectStoreNames.contains('photos')) {
          const photoStore = db.createObjectStore('photos', { keyPath: 'id' }); // folderId:stem
          photoStore.createIndex('folderId', 'folderId', { unique: false });
          photoStore.createIndex('stem', 'stem', { unique: false });
        }

        // 3. blobs store (Keyed by jpegFileId or local key, stores raw JPEG Blob)
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'key' }); // { key, blob, size, updatedAt }
        }

        // 4. xmps store (Cached original XMP text content to enable non-destructive patching)
        if (!db.objectStoreNames.contains('xmps')) {
          db.createObjectStore('xmps', { keyPath: 'key' }); // key = folderId:stem, { key, content }
        }

        // 5. syncQueue store (Dirty rating updates waiting to be written to Google Drive / local file)
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' }); // folderId:stem
          syncStore.createIndex('folderId', 'folderId', { unique: false });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async _ensureDb() {
    if (!this.db) {
      await this.initPromise;
    }
    return this.db;
  }

  // --- Shoots ---
  async saveShoot(shoot) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('shoots', 'readwrite');
      tx.objectStore('shoots').put(shoot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getShoot(folderId) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('shoots', 'readonly');
      const req = tx.objectStore('shoots').get(folderId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllShoots() {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('shoots', 'readonly');
      const req = tx.objectStore('shoots').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Photos ---
  async savePhotos(photos) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      for (const photo of photos) {
        store.put(photo);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getPhotosByFolder(folderId) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const index = tx.objectStore('photos').index('folderId');
      const req = index.getAll(folderId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async updatePhoto(photo) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(photo);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Blobs ---
  async saveBlob(key, blob) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put({ key, blob, size: blob.size, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBlob(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async hasBlob(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').getKey(key);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
    });
  }

  // --- XMPs ---
  async saveXmpContent(key, content) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('xmps', 'readwrite');
      tx.objectStore('xmps').put({ key, content, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getXmpContent(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('xmps', 'readonly');
      const req = tx.objectStore('xmps').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.content : null);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Sync Queue ---
  async enqueueSyncItem(item) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      tx.objectStore('syncQueue').put(item); // key is item.id = folderId:stem
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getPendingSyncItems(folderId = null) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      const req = folderId ? store.index('folderId').getAll(folderId) : store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async removeSyncItem(id) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite');
      tx.objectStore('syncQueue').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Maintenance & Cleanup ---
  async clearAllBlobs() {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async wipeAllData() {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['shoots', 'photos', 'blobs', 'xmps', 'syncQueue'], 'readwrite');
      tx.objectStore('shoots').clear();
      tx.objectStore('photos').clear();
      tx.objectStore('blobs').clear();
      tx.objectStore('xmps').clear();
      tx.objectStore('syncQueue').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      return await navigator.storage.estimate();
    }
    return { usage: 0, quota: 0 };
  }
}

export const cacheStore = new CacheStore();
