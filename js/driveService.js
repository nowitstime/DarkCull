/**
 * Google Drive API v3 & Google Identity Services OAuth2 Service
 * Handles Client ID configuration, OAuth token flow, folder listing/pagination,
 * file downloading (with concurrency pool), and multipart XMP creation/patching.
 */

const DRIVE_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const CLIENT_ID_KEY = 'darkcull_gdrive_client_id';

const ACCESS_TOKEN_KEY = 'darkcull_manual_access_token';

export class DriveService {
  constructor() {
    this.tokenClient = null;
    this.accessToken = localStorage.getItem(ACCESS_TOKEN_KEY) || null;
    this.tokenExpiresAt = this.accessToken ? Date.now() + 3600 * 1000 : 0;
  }

  getClientId() {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  }

  setClientId(clientId) {
    if (clientId) {
      localStorage.setItem(CLIENT_ID_KEY, clientId.trim());
    } else {
      localStorage.removeItem(CLIENT_ID_KEY);
    }
  }

  getManualToken() {
    return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
  }

  setManualToken(token) {
    if (token) {
      const cleanToken = token.trim();
      localStorage.setItem(ACCESS_TOKEN_KEY, cleanToken);
      this.accessToken = cleanToken;
      this.tokenExpiresAt = Date.now() + 3600 * 1000;
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      this.accessToken = null;
      this.tokenExpiresAt = 0;
    }
  }

  isAuthenticated() {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiresAt);
  }

  /**
   * Initializes Google Identity Services token client and prompts user for authentication.
   * @returns {Promise<string>} Returns access token
   */
  async authenticate() {
    // If user provided a direct manual OAuth Access Token (e.g. from OAuth Playground or script), use it
    const manualToken = this.getManualToken();
    if (manualToken) {
      this.accessToken = manualToken;
      return this.accessToken;
    }

    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error('Google Cloud OAuth Client ID is missing. Please set it in Settings.');
    }

    if (this.isAuthenticated()) {
      return this.accessToken;
    }

    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      throw new Error('Google Identity Services library is not loaded. Check internet connection or ad blocker.');
    }

    return new Promise((resolve, reject) => {
      try {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (response) => {
            if (response.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            this.accessToken = response.access_token;
            // expires_in is seconds
            const expiresIn = parseInt(response.expires_in, 10) || 3600;
            this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
            resolve(this.accessToken);
          },
        });

        // Prompt user consent or token retrieval
        this.tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Shared-promise wrapper so many parallel requests that hit an expired token
   * only trigger ONE Google sign-in popup instead of one per request.
   */
  _authenticateOnce() {
    if (!this._authPromise) {
      this._authPromise = this.authenticate().finally(() => {
        this._authPromise = null;
      });
    }
    return this._authPromise;
  }

  /**
   * Helper to perform authenticated fetch to Google APIs.
   * - Re-authenticates once on 401 (single shared popup)
   * - Retries 429 / 5xx and network errors with exponential backoff
   */
  async _authFetch(url, options = {}) {
    if (!this.isAuthenticated()) {
      await this._authenticateOnce();
    }

    const MAX_ATTEMPTS = 4;
    let reauthed = false;

    for (let attempt = 1; ; attempt++) {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${this.accessToken}`);

      let response;
      try {
        response = await fetch(url, { ...options, headers });
      } catch (netErr) {
        if (attempt >= MAX_ATTEMPTS) throw netErr;
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
        continue;
      }

      if (response.status === 401 && !reauthed) {
        reauthed = true;
        if (this.getManualToken()) {
          // A pasted token can't be refreshed automatically
          throw new Error('Your pasted access token has expired. Paste a new one in Settings (or use a Client ID).');
        }
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        await this._authenticateOnce();
        continue;
      }

      const retryable = response.status === 429 || response.status >= 500 ||
        (response.status === 403 && attempt < MAX_ATTEMPTS && /rate|quota/i.test(response.statusText || ''));
      if (retryable && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1) + Math.random() * 250));
        continue;
      }

      return response;
    }
  }

  /**
   * Lists folders from Google Drive to populate folder picker
   */
  async listFolders(pageSize = 50) {
    const query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', query);
    url.searchParams.set('pageSize', pageSize.toString());
    url.searchParams.set('fields', 'nextPageToken, files(id, name, modifiedTime)');
    url.searchParams.set('orderBy', 'modifiedTime desc');

    const res = await this._authFetch(url.toString());
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to list folders (${res.status})`);
    }
    const data = await res.json();
    return data.files || [];
  }

  /**
   * Gets metadata for a specific folder by ID
   */
  async getFolderMeta(folderId) {
    const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`;
    const res = await this._authFetch(url);
    if (!res.ok) {
      throw new Error(`Failed to get folder info for ID ${folderId}`);
    }
    return await res.json();
  }

  /**
   * Indexes all non-trashed files within a target Google Drive folder.
   * Handles pagination completely.
   */
  async listFilesInFolder(folderId, onProgress = null) {
    let allFiles = [];
    let pageToken = null;
    let pageCount = 0;

    const safeFolderId = String(folderId).replace(/'/g, "\\'");
    const query = `'${safeFolderId}' in parents and trashed = false`;

    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', query);
      url.searchParams.set('pageSize', '1000');
      // In Google API REST, fields list MUST NOT contain spaces after commas
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime)');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const res = await this._authFetch(url.toString());
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Error scanning folder files (${res.status})`);
      }

      const data = await res.json();
      const files = data.files || [];
      allFiles = allFiles.concat(files);
      pageToken = data.nextPageToken ? String(data.nextPageToken) : null;
      pageCount++;

      console.log(`[Drive] Page ${pageCount}: fetched ${files.length} items (total ${allFiles.length}). Continuation: ${pageToken ? 'YES' : 'END'}`);

      if (onProgress) {
        onProgress(allFiles.length, pageCount);
      }
    } while (pageToken);

    return allFiles;
  }

  /**
   * Downloads a binary file as a Blob (e.g. JPEG image)
   */
  async downloadBlob(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this._authFetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download file ${fileId} (${res.status})`);
    }
    return await res.blob();
  }

  /**
   * Downloads a text file (e.g. .xmp sidecar)
   */
  async downloadText(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this._authFetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download XMP text ${fileId} (${res.status})`);
    }
    return await res.text();
  }

  /**
   * Creates a new .xmp sidecar file via Google Drive multipart upload.
   * @param {string} folderId
   * @param {string} fileName (e.g. P1010234.RW2.xmp)
   * @param {string} xmlContent
   * @returns {Promise<{id: string, name: string}>}
   */
  async createXmpFile(folderId, fileName, xmlContent) {
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/xml',
    };

    const boundary = '-------darkcull_multipart_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const body =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/xml; charset=UTF-8\r\n\r\n' +
      xmlContent +
      closeDelimiter;

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
    const res = await this._authFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: body,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to create XMP file ${fileName} (${res.status})`);
    }

    return await res.json();
  }

  /**
   * Updates an existing .xmp sidecar file via Google Drive media upload.
   * @param {string} fileId
   * @param {string} xmlContent
   */
  async updateXmpFile(fileId, xmlContent) {
    const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    const res = await this._authFetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
      },
      body: xmlContent,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to update XMP file ${fileId} (${res.status})`);
    }

    return await res.json();
  }
}

export const driveService = new DriveService();
