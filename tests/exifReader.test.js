import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExifReader } from '../js/exifReader.js';
import { createSyntheticExifJpeg } from './testHelper.js';

describe('ExifReader', () => {
  describe('parseExifTimestamp', () => {
    it('parses standard EXIF colon-separated timestamp', () => {
      const ts = ExifReader.parseExifTimestamp('2023:08:25 14:30:15');
      assert.equal(typeof ts, 'number');
      const expected = Date.UTC(2023, 7, 25, 14, 30, 15, 0);
      assert.equal(ts, expected);
    });

    it('parses standard EXIF with subseconds parameter', () => {
      const ts = ExifReader.parseExifTimestamp('2023:08:25 14:30:15', '45');
      const expected = Date.UTC(2023, 7, 25, 14, 30, 15, 450);
      assert.equal(ts, expected);
    });

    it('parses ISO 8601 timestamp with T delimiter from Google Drive', () => {
      const ts = ExifReader.parseExifTimestamp('2023-08-25T14:30:15');
      const expected = Date.UTC(2023, 7, 25, 14, 30, 15, 0);
      assert.equal(ts, expected);
    });

    it('parses ISO 8601 timestamp with embedded fractional milliseconds', () => {
      const ts = ExifReader.parseExifTimestamp('2023-08-25T14:30:15.500Z');
      const expected = Date.UTC(2023, 7, 25, 14, 30, 15, 500);
      assert.equal(ts, expected);
    });

    it('returns null on invalid or empty inputs', () => {
      assert.equal(ExifReader.parseExifTimestamp(null), null);
      assert.equal(ExifReader.parseExifTimestamp(undefined), null);
      assert.equal(ExifReader.parseExifTimestamp(''), null);
      assert.equal(ExifReader.parseExifTimestamp('not a valid date'), null);
      assert.equal(ExifReader.parseExifTimestamp(12345), null);
    });
  });

  describe('parse (binary JPEG APP1 buffer)', () => {
    it('extracts aperture, shutter speed, ISO, exposure compensation, and focal length from valid synthetic JPEG', () => {
      const buffer = createSyntheticExifJpeg({
        aperture: 2.8,
        exposureTime: 0.004, // 1/250s
        iso: 800,
        exposureBias: -0.3,
        focalLength: 35,
        dateTimeOriginal: '2023:10:15 14:30:15',
        subSec: '50',
      });

      const exif = ExifReader.parse(buffer);
      assert.ok(exif, 'EXIF should not be null');
      assert.equal(exif.aperture, 'f/2.8');
      assert.equal(exif.shutterSpeed, '1/250s');
      assert.equal(exif.iso, 'ISO 800');
      assert.equal(exif.exposureCompensation, '-0.3 EV');
      assert.equal(exif.focalLength, '35mm');
      assert.equal(exif.dateTimeOriginal, '2023:10:15 14:30:15');
      assert.equal(exif.subSecTimeOriginal, '50');
      assert.equal(exif.timestampMs, Date.UTC(2023, 9, 15, 14, 30, 15, 500));
      assert.equal(exif.formatted, 'f/2.8 · 1/250s · ISO 800 · -0.3 EV · 35mm');
    });

    it('formats longer shutter speeds (>= 1s) correctly', () => {
      const buffer = createSyntheticExifJpeg({
        exposureTime: 2.0, // 2s
      });
      const exif = ExifReader.parse(buffer);
      assert.ok(exif);
      assert.equal(exif.shutterSpeed, '2s');
    });

    it('returns null on non-JPEG buffer (missing SOI 0xFFD8)', () => {
      const buffer = new ArrayBuffer(100);
      assert.equal(ExifReader.parse(buffer), null);
    });

    it('returns null on truncated buffer (< 4 bytes)', () => {
      const buffer = new ArrayBuffer(2);
      assert.equal(ExifReader.parse(buffer), null);
    });

    it('returns null when APP1 marker is missing', () => {
      const buffer = new ArrayBuffer(32);
      const view = new DataView(buffer);
      view.setUint16(0, 0xFFD8); // SOI
      view.setUint16(2, 0xFFE0); // APP0 (JFIF) instead of APP1
      view.setUint16(4, 16);
      assert.equal(ExifReader.parse(buffer), null);
    });
  });

  describe('readFromBlob', () => {
    it('reads and parses EXIF from a Blob', async () => {
      const buffer = createSyntheticExifJpeg({
        aperture: 1.4,
        iso: 1600,
      });
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const exif = await ExifReader.readFromBlob(blob);
      assert.ok(exif);
      assert.equal(exif.aperture, 'f/1.4');
      assert.equal(exif.iso, 'ISO 1600');
    });

    it('returns null for null blob', async () => {
      const exif = await ExifReader.readFromBlob(null);
      assert.equal(exif, null);
    });
  });
});
