import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('PWA, Manifest & HTML Integrity', () => {
  describe('manifest.json', () => {
    it('is valid JSON and has required PWA properties', () => {
      const manifestPath = path.join(ROOT_DIR, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content);

      assert.equal(manifest.name, 'DarkCull');
      assert.equal(manifest.short_name, 'DarkCull');
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, './index.html');
      assert.equal(manifest.background_color, '#000000');
      assert.equal(manifest.theme_color, '#000000');
      assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
    });

    it('ensures all icon files referenced in manifest.json physically exist on disk', () => {
      const manifestPath = path.join(ROOT_DIR, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      for (const icon of manifest.icons) {
        const iconPath = path.join(ROOT_DIR, icon.src);
        assert.ok(fs.existsSync(iconPath), `Icon file ${icon.src} must exist at ${iconPath}`);
        const stat = fs.statSync(iconPath);
        assert.ok(stat.size > 0, `Icon ${icon.src} must not be empty`);
      }
    });
  });

  describe('Service Worker (sw.js)', () => {
    it('has matching version 1.6 in CACHE_NAME', () => {
      const swPath = path.join(ROOT_DIR, 'sw.js');
      assert.ok(fs.existsSync(swPath));

      const swContent = fs.readFileSync(swPath, 'utf8');
      assert.ok(swContent.includes("APP_VERSION = '1.6'"), 'sw.js must be at version 1.6');
      assert.ok(swContent.includes('darkcull-shell-v'), 'sw.js must use versioned cache name');
    });

    it('ensures every static asset listed in STATIC_ASSETS exists on disk', () => {
      const swPath = path.join(ROOT_DIR, 'sw.js');
      const swContent = fs.readFileSync(swPath, 'utf8');

      const match = swContent.match(/const STATIC_ASSETS = \[(.*?)\];/s);
      assert.ok(match, 'STATIC_ASSETS array must be found in sw.js');

      const rawAssets = match[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith("'") || line.startsWith('"'))
        .map((line) => line.replace(/['",]/g, ''));

      assert.ok(rawAssets.length > 5, 'STATIC_ASSETS must contain app shell files');

      for (const asset of rawAssets) {
        if (asset === './') continue; // directory index
        const cleanPath = asset.replace(/^\.\//, '');
        const fullPath = path.join(ROOT_DIR, cleanPath);
        assert.ok(fs.existsSync(fullPath), `Asset ${asset} in STATIC_ASSETS must exist at ${fullPath}`);
      }
    });
  });

  describe('index.html DOM mapping integrity', () => {
    it('contains all DOM element IDs expected by DarkCullApp', () => {
      const htmlPath = path.join(ROOT_DIR, 'index.html');
      assert.ok(fs.existsSync(htmlPath));
      const html = fs.readFileSync(htmlPath, 'utf8');

      const expectedIds = [
        'hudInfoPill',
        'hudSyncDot',
        'hudSyncBtn',
        'hudFilename',
        'hudFormatBadge',
        'hudBurstBadge',
        'hudIndex',
        'hudExifPill',
        'exifText',
        'cacheProgressBar',
        'cacheProgressText',
        'cacheProgressFill',
        'scrubPreview',
        'scrubThumbImg',
        'scrubThumbPlaceholder',
        'scrubPreviewIndex',
        'scrubPreviewName',
        'scrubPreviewBurst',
        'scrubPreviewFill',
        'tallyTotal',
        'tallyUnrated',
        'tally3',
        'tally4',
        'tally5',
        'tallyRejected',
        'filterCountNotRejected',
        'filterCountUnrated',
        'filterCount3',
        'filterCount4',
        'filterCount5',
        'filterCountRejected',
        'filterCountAll',
        'viewport',
        'mainImg',
        'emptyState',
        'emptyOpenLocalBtn',
        'emptyOpenDriveBtn',
        'rawNotice',
        'rawNoticeFilename',
        'loupeIndicator',
        'swipeBadge',
        'loadingSpinner',
        'gestureHintBar',
        'bottomDock',
        'btnPrev',
        'dockStatusPill',
        'btnNext',
        'settingsBtn',
        'folderSelectBtn',
        'localFolderBtn',
        'settingsModal',
        'closeSettingsBtn',
        'clientIdInput',
        'saveClientIdBtn',
        'clearClientIdBtn',
        'manualTokenInput',
        'saveManualTokenBtn',
        'clearManualTokenBtn',
        'gestureUpSelect',
        'gestureDownSelect',
        'gestureLeftSelect',
        'gestureRightSelect',
        'gestureHoldSelect',
        'presetStarsBtn',
        'presetRejectSkipBtn',
        'autoAdvanceToggle',
        'cacheEntireShootBtn',
        'clearCacheBtn',
        'storageQuotaText',
        'appVersionText',
        'updateAppBtn',
        'updateAppBtnLabel',
        'folderModal',
        'closeFolderModalBtn',
        'folderList',
        'manualFolderInput',
        'loadManualFolderBtn',
        'folderLoading',
        'toast',
      ];

      for (const id of expectedIds) {
        const idRegex = new RegExp(`id=["']${id}["']`);
        assert.ok(idRegex.test(html), `index.html must contain element with id="${id}"`);
      }
    });

    it('displays the current version badge v1.6 in settings footer', () => {
      const htmlPath = path.join(ROOT_DIR, 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.ok(html.includes('id="appVersionText" class="version-badge">v1.6<'));
    });
  });
});
