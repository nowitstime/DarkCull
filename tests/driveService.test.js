import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment } from './testHelper.js';
import { DriveService } from '../js/driveService.js';

describe('DriveService', () => {
  let drive;
  let env;

  beforeEach(() => {
    env = setupTestEnvironment();
    drive = new DriveService();
  });

  describe('Client ID & Manual Token storage', () => {
    it('sets and gets Google OAuth Client ID', () => {
      assert.equal(drive.getClientId(), '');
      drive.setClientId('test-client-123.apps.googleusercontent.com');
      assert.equal(drive.getClientId(), 'test-client-123.apps.googleusercontent.com');
      assert.equal(env.localStorage.getItem('darkcull_gdrive_client_id'), 'test-client-123.apps.googleusercontent.com');

      drive.setClientId('');
      assert.equal(drive.getClientId(), '');
      assert.equal(env.localStorage.getItem('darkcull_gdrive_client_id'), null);
    });

    it('sets and gets Direct Manual OAuth Access Token', () => {
      assert.equal(drive.getManualToken(), '');
      assert.equal(drive.isAuthenticated(), false);

      drive.setManualToken('ya29.test-bearer-token');
      assert.equal(drive.getManualToken(), 'ya29.test-bearer-token');
      assert.equal(drive.isAuthenticated(), true);

      drive.setManualToken('');
      assert.equal(drive.getManualToken(), '');
      assert.equal(drive.isAuthenticated(), false);
    });

    it('reports isAuthenticated() correctly based on expiration time', () => {
      drive.accessToken = 'test-token';
      drive.tokenExpiresAt = Date.now() + 60000; // in future
      assert.equal(drive.isAuthenticated(), true);

      drive.tokenExpiresAt = Date.now() - 1000; // in past
      assert.equal(drive.isAuthenticated(), false);

      drive.accessToken = null;
      assert.equal(drive.isAuthenticated(), false);
    });
  });

  describe('listFilesInFolder (pagination & fields)', () => {
    it('paginates across multiple pages and accumulates all files', async () => {
      drive.setManualToken('test-token');

      let pageCallCount = 0;
      globalThis.fetch = async (url) => {
        pageCallCount++;
        const parsedUrl = new URL(url);
        assert.ok(parsedUrl.searchParams.get('fields').includes('imageMediaMetadata(time)'));
        assert.equal(parsedUrl.searchParams.get('supportsAllDrives'), 'true');

        if (pageCallCount === 1) {
          return new Response(
            JSON.stringify({
              nextPageToken: 'token_page_2',
              files: [
                { id: 'f1', name: 'IMG_001.JPG' },
                { id: 'f2', name: 'IMG_001.CR3' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } else {
          return new Response(
            JSON.stringify({
              nextPageToken: null,
              files: [
                { id: 'f3', name: 'IMG_002.JPG' },
                { id: 'f4', name: 'IMG_002.CR3' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      };

      const progressCalls = [];
      const files = await drive.listFilesInFolder('folder_123', (count, page) => {
        progressCalls.push({ count, page });
      });

      assert.equal(files.length, 4);
      assert.equal(pageCallCount, 2);
      assert.deepEqual(progressCalls, [
        { count: 2, page: 1 },
        { count: 4, page: 2 },
      ]);
    });

    it('throws descriptive error on API failure', async () => {
      drive.setManualToken('test-token');
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ error: { message: 'Invalid folder ID' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await assert.rejects(
        () => drive.listFilesInFolder('bad_folder'),
        /Invalid folder ID/
      );
    });
  });

  describe('createXmpFile & updateXmpFile', () => {
    it('constructs valid multipart upload request for creating XMP files', async () => {
      drive.setManualToken('test-token');

      let capturedUrl = '';
      let capturedMethod = '';
      let capturedContentType = '';
      let capturedBody = '';

      globalThis.fetch = async (url, options) => {
        capturedUrl = url;
        capturedMethod = options.method;
        capturedContentType = options.headers.get('Content-Type');
        capturedBody = options.body;
        return new Response(JSON.stringify({ id: 'xmp_file_99', name: 'P101.RW2.xmp' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const res = await drive.createXmpFile('folder_1', 'P101.RW2.xmp', '<x:xmpmeta/>');
      assert.equal(res.id, 'xmp_file_99');
      assert.equal(capturedMethod, 'POST');
      assert.ok(capturedUrl.includes('uploadType=multipart'));
      assert.ok(capturedContentType.includes('multipart/related; boundary='));
      assert.ok(capturedBody.includes('"name":"P101.RW2.xmp"'));
      assert.ok(capturedBody.includes('"parents":["folder_1"]'));
      assert.ok(capturedBody.includes('<x:xmpmeta/>'));
    });

    it('sends PATCH request with XML body for updateXmpFile', async () => {
      drive.setManualToken('test-token');

      let capturedMethod = '';
      let capturedBody = '';

      globalThis.fetch = async (url, options) => {
        capturedMethod = options.method;
        capturedBody = options.body;
        return new Response(JSON.stringify({ id: 'xmp_file_99' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await drive.updateXmpFile('xmp_file_99', '<updated_xml/>');
      assert.equal(capturedMethod, 'PATCH');
      assert.equal(capturedBody, '<updated_xml/>');
    });
  });

  describe('_authFetch retry and error resilience', () => {
    it('retries on 429 rate limit errors with backoff before succeeding', async () => {
      drive.setManualToken('test-token');
      let attempts = 0;

      globalThis.fetch = async () => {
        attempts++;
        if (attempts < 3) {
          return new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const res = await drive._authFetch('https://www.googleapis.com/test');
      assert.equal(res.status, 200);
      assert.equal(attempts, 3);
    });

    it('rejects with helpful message if manual token is expired on 401', async () => {
      drive.setManualToken('expired-manual-token');
      globalThis.fetch = async () => {
        return new Response('Unauthorized', { status: 401 });
      };

      await assert.rejects(
        () => drive._authFetch('https://www.googleapis.com/test'),
        /pasted access token has expired/
      );
    });
  });
});
