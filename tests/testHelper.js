/**
 * testHelper.js: Lightweight in-memory browser and IndexedDB mocks for Node.js test environment.
 * Enables zero-dependency unit and integration testing of DarkCull modules in Node 20+.
 */

// In-Memory LocalStorage Mock
export class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
}

// In-Memory Mock DOM Element
export class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this._textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.listeners = new Map();
    this.title = '';
    this.src = '';

    const self = this;
    this.classList = {
      add(...classes) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const c of classes) set.add(c);
        self.className = Array.from(set).join(' ');
      },
      remove(...classes) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const c of classes) set.delete(c);
        self.className = Array.from(set).join(' ');
      },
      toggle(cls, force) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        const shouldAdd = force !== undefined ? force : !set.has(cls);
        if (shouldAdd) set.add(cls);
        else set.delete(cls);
        self.className = Array.from(set).join(' ');
        return shouldAdd;
      },
      contains(cls) {
        return self.className.split(/\s+/).includes(cls);
      },
    };
  }

  get textContent() {
    return this._textContent !== undefined ? this._textContent : '';
  }

  set textContent(val) {
    this._textContent = val === null || val === undefined ? '' : String(val);
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  removeEventListener(event, handler) {
    if (!this.listeners.has(event)) return;
    this.listeners.set(event, this.listeners.get(event).filter((h) => h !== handler));
  }

  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) {
      h.call(this, event);
    }
    return !event.defaultPrevented;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  closest(selector) {
    if (selector.startsWith('#') && this.id === selector.slice(1)) return this;
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('#') && child.id === selector.slice(1)) return child;
      if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) {
          results.push(child);
        } else if (selector.startsWith('#') && child.id === selector.slice(1)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  getBoundingClientRect() {
    return {
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
    };
  }
}

// In-Memory Mock IndexedDB
export class MockIDBDatabase {
  constructor(name) {
    this.name = name;
    this.stores = new Map();
  }

  get objectStoreNames() {
    const list = Array.from(this.stores.keys());
    list.contains = (name) => this.stores.has(name);
    return list;
  }

  createObjectStore(storeName, options = {}) {
    const store = new MockIDBObjectStore(storeName, options);
    this.stores.set(storeName, store);
    return store;
  }

  transaction(storeNames, mode = 'readonly') {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new MockIDBTransaction(this, names, mode);
  }

  close() {}
}

export class MockIDBObjectStore {
  constructor(name, options = {}) {
    this.name = name;
    this.keyPath = options.keyPath || null;
    this.autoIncrement = options.autoIncrement || false;
    this.data = new Map();
    this.indexes = new Map();
  }

  createIndex(indexName, keyPath, options = {}) {
    const idx = { name: indexName, keyPath, unique: Boolean(options.unique) };
    this.indexes.set(indexName, idx);
    return idx;
  }

  index(indexName) {
    const idxMeta = this.indexes.get(indexName);
    if (!idxMeta) throw new Error(`Index not found: ${indexName}`);
    return {
      getAll: (query) => {
        const req = new MockIDBRequest();
        setTimeout(() => {
          const results = [];
          for (const val of this.data.values()) {
            if (val && val[idxMeta.keyPath] === query) {
              results.push(structuredClone(val));
            }
          }
          req.result = results;
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      },
    };
  }

  put(item, key = null) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      let actualKey = key;
      if (!actualKey && this.keyPath && item && item[this.keyPath]) {
        actualKey = item[this.keyPath];
      }
      if (!actualKey && item.key) actualKey = item.key;
      if (!actualKey && item.id) actualKey = item.id;
      if (!actualKey) actualKey = String(this.data.size + 1);

      this.data.set(actualKey, structuredClone(item));
      req.result = actualKey;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }

  get(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      const val = this.data.get(key);
      req.result = val ? structuredClone(val) : undefined;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }

  getKey(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      req.result = this.data.has(key) ? key : undefined;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }

  getAll() {
    const req = new MockIDBRequest();
    setTimeout(() => {
      const results = [];
      for (const val of this.data.values()) {
        results.push(structuredClone(val));
      }
      req.result = results;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }

  getAllKeys() {
    const req = new MockIDBRequest();
    setTimeout(() => {
      req.result = Array.from(this.data.keys());
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }

  delete(key) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      this.data.delete(key);
      req.result = undefined;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }

  clear() {
    const req = new MockIDBRequest();
    setTimeout(() => {
      this.data.clear();
      req.result = undefined;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
}

export class MockIDBTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = storeNames;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;

    setTimeout(() => {
      if (this.oncomplete) this.oncomplete({ target: this });
    }, 5);
  }

  objectStore(name) {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`ObjectStore not found: ${name}`);
    return store;
  }
}

export class MockIDBRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

export class MockIDBFactory {
  constructor() {
    this.databases = new Map();
  }

  open(name, version = 1) {
    const req = new MockIDBRequest();
    setTimeout(() => {
      let db = this.databases.get(name);
      const isNew = !db;
      if (!db) {
        db = new MockIDBDatabase(name);
        this.databases.set(name, db);
      }

      if (isNew && req.onupgradeneeded) {
        req.result = db;
        req.onupgradeneeded({ target: req, oldVersion: 0, newVersion: version });
      }

      req.result = db;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
}

/**
 * Installs all mock browser globals into globalThis.
 */
export function setupTestEnvironment() {
  const localStorage = new MockLocalStorage();
  const elements = new Map();

  const document = {
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      if (!elements.has(id)) {
        elements.set(id, new MockElement('div', id));
      }
      return elements.get(id);
    },
    querySelectorAll: (selector) => {
      const results = [];
      for (const el of elements.values()) {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) {
          results.push(el);
        }
      }
      return results;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    fullscreenElement: null,
    exitFullscreen: async () => {},
    documentElement: {
      requestFullscreen: async () => {},
    },
  };

  const objectUrlStore = new Map();
  let urlCounter = 0;

  URL.createObjectURL = (blob) => {
    const url = `blob:test-app/${++urlCounter}`;
    objectUrlStore.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    objectUrlStore.delete(url);
  };
  URL._getStore = () => objectUrlStore;

  class MockImage {
    constructor() {
      this.src = '';
      this.width = 100;
      this.height = 100;
    }
    async decode() {
      return Promise.resolve();
    }
  }

  const windowListeners = new Map();
  const windowMock = {
    addEventListener: (event, handler) => {
      if (!windowListeners.has(event)) windowListeners.set(event, []);
      windowListeners.get(event).push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!windowListeners.has(event)) return;
      windowListeners.set(event, windowListeners.get(event).filter((h) => h !== handler));
    },
    dispatchEvent: (event) => {
      const handlers = windowListeners.get(event.type) || [];
      for (const h of handlers) h.call(windowMock, event);
    },
    listeners: windowListeners,
    innerWidth: 1024,
    innerHeight: 768,
    location: {
      href: 'https://localhost/index.html',
      replace: () => {},
    },
    caches: {
      keys: async () => ['darkcull-shell-v1.4'],
      delete: async () => true,
      open: async () => ({
        addAll: async () => {},
        put: async () => {},
        match: async () => null,
      }),
    },
  };

  const navigatorMock = {
    onLine: true,
    vibrate: () => true,
    serviceWorker: {
      register: async () => ({}),
      getRegistrations: async () => [],
    },
    storage: {
      estimate: async () => ({ usage: 50 * 1024 * 1024, quota: 1000 * 1024 * 1024 }),
    },
  };

  globalThis.window = windowMock;
  globalThis.document = document;
  globalThis.localStorage = localStorage;
  globalThis.navigator = navigatorMock;
  globalThis.Image = MockImage;
  globalThis.indexedDB = new MockIDBFactory();

  return {
    localStorage,
    document,
    elements,
    URL,
    indexedDB: globalThis.indexedDB,
  };
}

export const defaultEnv = setupTestEnvironment();

/**
 * Creates a synthetic JPEG binary buffer with valid APP1 / EXIF TIFF metadata.
 * Useful for end-to-end testing of binary EXIF extraction without external image files.
 */
export function createSyntheticExifJpeg({
  aperture = 2.8,
  exposureTime = 0.004, // 1/250s
  iso = 400,
  exposureBias = -0.3,
  focalLength = 50,
  dateTimeOriginal = '2023:10:15 14:30:15',
  subSec = '50',
} = {}) {
  // We construct:
  // SOI: 0xFFD8
  // APP1: 0xFFE1, length (2 bytes), "Exif\0\0" (6 bytes)
  // TIFF: Byte order "II" (0x4949), 42 (0x002A), IFD0 offset (0x00000008)
  // IFD0: 1 entry pointing to ExifSubIFD (tag 0x8769)
  // ExifSubIFD: entries for ExposureTime (0x829A), FNumber (0x829D), ISO (0x8827),
  //             ExposureBias (0x9204), FocalLength (0x920A), DateTimeOriginal (0x9003),
  //             SubSecTimeOriginal (0x9291)
  const buffer = new ArrayBuffer(2048);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // SOI
  view.setUint16(0, 0xFFD8);

  // APP1 Marker
  view.setUint16(2, 0xFFE1);
  // APP1 Length (will fill later)
  view.setUint16(4, 2040);

  // "Exif\0\0"
  u8.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);

  // TIFF Header starts at offset 12
  const tiffOffset = 12;
  // Intel little endian "II"
  view.setUint16(tiffOffset, 0x4949);
  // 42
  view.setUint16(tiffOffset + 2, 0x002A, true);
  // Offset to IFD0 = 8
  view.setUint32(tiffOffset + 4, 8, true);

  // IFD0 at tiffOffset + 8 = offset 20
  const ifd0 = tiffOffset + 8;
  view.setUint16(ifd0, 1, true); // 1 entry: ExifSubIFD pointer

  // Entry 1: tag 0x8769, type LONG (4), count 1, valueOffset to SubIFD
  const subIfdRelative = 32; // from tiffOffset
  view.setUint16(ifd0 + 2, 0x8769, true);
  view.setUint16(ifd0 + 4, 4, true); // LONG
  view.setUint32(ifd0 + 6, 1, true); // count
  view.setUint32(ifd0 + 10, subIfdRelative, true); // value offset

  // Next IFD offset = 0
  view.setUint32(ifd0 + 14, 0, true);

  // SubIFD starts at tiffOffset + 32 = offset 44
  const subIfd = tiffOffset + subIfdRelative;
  const numTags = 7;
  view.setUint16(subIfd, numTags, true);

  let curEntry = subIfd + 2;
  let dataPool = 240; // relative to tiffOffset for out-of-entry values

  // 1. ExposureTime (0x829A, RATIONAL=5, count=1)
  view.setUint16(curEntry, 0x829A, true);
  view.setUint16(curEntry + 2, 5, true);
  view.setUint32(curEntry + 4, 1, true);
  view.setUint32(curEntry + 8, dataPool, true);
  if (exposureTime < 1) {
    const den = Math.round(1 / exposureTime);
    view.setUint32(tiffOffset + dataPool, 1, true);
    view.setUint32(tiffOffset + dataPool + 4, den, true);
  } else {
    view.setUint32(tiffOffset + dataPool, Math.round(exposureTime), true);
    view.setUint32(tiffOffset + dataPool + 4, 1, true);
  }
  dataPool += 8;
  curEntry += 12;

  // 2. FNumber (0x829D, RATIONAL=5, count=1)
  view.setUint16(curEntry, 0x829D, true);
  view.setUint16(curEntry + 2, 5, true);
  view.setUint32(curEntry + 4, 1, true);
  view.setUint32(curEntry + 8, dataPool, true);
  view.setUint32(tiffOffset + dataPool, Math.round(aperture * 10), true);
  view.setUint32(tiffOffset + dataPool + 4, 10, true);
  dataPool += 8;
  curEntry += 12;

  // 3. ISOSpeedRatings (0x8827, SHORT=3, count=1)
  view.setUint16(curEntry, 0x8827, true);
  view.setUint16(curEntry + 2, 3, true);
  view.setUint32(curEntry + 4, 1, true);
  view.setUint16(curEntry + 8, iso, true); // fits in 4 bytes
  curEntry += 12;

  // 4. ExposureBias (0x9204, SRATIONAL=10, count=1)
  view.setUint16(curEntry, 0x9204, true);
  view.setUint16(curEntry + 2, 10, true);
  view.setUint32(curEntry + 4, 1, true);
  view.setUint32(curEntry + 8, dataPool, true);
  view.setInt32(tiffOffset + dataPool, Math.round(exposureBias * 10), true);
  view.setInt32(tiffOffset + dataPool + 4, 10, true);
  dataPool += 8;
  curEntry += 12;

  // 5. FocalLength (0x920A, RATIONAL=5, count=1)
  view.setUint16(curEntry, 0x920A, true);
  view.setUint16(curEntry + 2, 5, true);
  view.setUint32(curEntry + 4, 1, true);
  view.setUint32(curEntry + 8, dataPool, true);
  view.setUint32(tiffOffset + dataPool, Math.round(focalLength * 10), true);
  view.setUint32(tiffOffset + dataPool + 4, 10, true);
  dataPool += 8;
  curEntry += 12;

  // 6. DateTimeOriginal (0x9003, ASCII=2, count=20)
  const dtStr = `${dateTimeOriginal}\0`;
  view.setUint16(curEntry, 0x9003, true);
  view.setUint16(curEntry + 2, 2, true);
  view.setUint32(curEntry + 4, dtStr.length, true);
  view.setUint32(curEntry + 8, dataPool, true);
  for (let c = 0; c < dtStr.length; c++) {
    u8[tiffOffset + dataPool + c] = dtStr.charCodeAt(c);
  }
  dataPool += Math.ceil(dtStr.length / 4) * 4;
  curEntry += 12;

  // 7. SubSecTimeOriginal (0x9291, ASCII=2)
  const subStr = `${subSec}\0`;
  const subLen = subStr.length;
  view.setUint16(curEntry, 0x9291, true);
  view.setUint16(curEntry + 2, 2, true);
  view.setUint32(curEntry + 4, subLen, true);
  if (subLen <= 4) {
    // In TIFF, ASCII strings <= 4 bytes are stored inline in the 4-byte offset field
    for (let c = 0; c < 4; c++) {
      u8[curEntry + 8 + c] = c < subLen ? subStr.charCodeAt(c) : 0;
    }
  } else {
    view.setUint32(curEntry + 8, dataPool, true);
    for (let c = 0; c < subLen; c++) {
      u8[tiffOffset + dataPool + c] = subStr.charCodeAt(c);
    }
    dataPool += Math.ceil(subLen / 4) * 4;
  }
  curEntry += 12;

  return buffer;
}
