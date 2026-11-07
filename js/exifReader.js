/**
 * ExifReader.js: Ultra-fast, zero-dependency client-side EXIF reader for JPEG images.
 * Extracts camera exposure parameters directly from APP1 Exif TIFF metadata:
 * - Aperture / FNumber (0x829D)
 * - Shutter Speed / Exposure Time (0x829A)
 * - ISO Speed Ratings (0x8827)
 * - Exposure Compensation / Bias (0x9204)
 * - Focal Length (0x920A)
 *
 * Slices only the first 128KB of the JPEG Blob for sub-millisecond execution.
 */

export class ExifReader {
  /**
   * Reads EXIF metadata from a Blob or File.
   * @param {Blob|File} blob 
   * @returns {Promise<ExifData|null>}
   */
  static async readFromBlob(blob) {
    if (!blob) return null;
    try {
      // Slicing 128KB is virtually instantaneous and easily covers the APP1 header
      const slice = blob.slice(0, 131072);
      const buffer = await slice.arrayBuffer();
      return this.parse(buffer);
    } catch (err) {
      console.warn('Failed to read EXIF from blob:', err);
      return null;
    }
  }

  /**
   * Parses EXIF data from an ArrayBuffer
   * @param {ArrayBuffer} buffer
   * @returns {ExifData|null}
   */
  static parse(buffer) {
    try {
      const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset, buffer.byteLength);
      if (view.byteLength < 4) return null;

      // Check JPEG SOI marker (0xFFD8)
      if (view.getUint16(0) !== 0xFFD8) return null;

      let offset = 2;
      let tiffOffset = -1;

      // Scan markers for APP1 (0xFFE1) containing "Exif\0\0"
      while (offset + 4 < view.byteLength) {
        const marker = view.getUint16(offset);
        offset += 2;

        // SOS (Start of Scan) or EOI: image compressed data begins
        if (marker === 0xFFDA || marker === 0xFFD9) break;

        const length = view.getUint16(offset);
        if (marker === 0xFFE1 && length >= 8) {
          // Check "Exif\0\0" (0x45786966 and 0x0000)
          const exifHeader = view.getUint32(offset + 2);
          const exifZero = view.getUint16(offset + 6);
          if (exifHeader === 0x45786966 && exifZero === 0x0000) {
            tiffOffset = offset + 8;
            break;
          }
        }

        offset += length;
      }

      if (tiffOffset === -1 || tiffOffset + 8 > view.byteLength) return null;

      // Read byte order in TIFF header ("II" for Little Endian, "MM" for Big Endian)
      const byteOrder = view.getUint16(tiffOffset);
      let littleEndian = false;
      if (byteOrder === 0x4949) {
        littleEndian = true; // Intel
      } else if (byteOrder === 0x4D4D) {
        littleEndian = false; // Motorola
      } else {
        return null;
      }

      // Fixed 42 number
      if (view.getUint16(tiffOffset + 2, littleEndian) !== 0x002A) return null;

      const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
      if (firstIfdOffset < 8) return null;

      const ifd0Offset = tiffOffset + firstIfdOffset;
      if (ifd0Offset + 2 > view.byteLength) return null;

      const ifd0Entries = view.getUint16(ifd0Offset, littleEndian);
      let exifSubIfdOffset = -1;
      let ifd0DateTimeStr = null;

      const readAsciiString = (entryOffset) => {
        const count = view.getUint32(entryOffset + 4, littleEndian);
        if (count <= 0 || count > 64) return null;
        const valOffset = count <= 4 ? entryOffset + 8 : tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
        if (valOffset + count > view.byteLength) return null;
        let str = '';
        for (let c = 0; c < count - 1; c++) {
          const ch = view.getUint8(valOffset + c);
          if (ch === 0) break;
          str += String.fromCharCode(ch);
        }
        return str.trim();
      };

      for (let i = 0; i < ifd0Entries; i++) {
        const entryOffset = ifd0Offset + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tag = view.getUint16(entryOffset, littleEndian);
        if (tag === 0x8769) {
          // Exif IFD Pointer
          exifSubIfdOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
        } else if (tag === 0x0132) {
          // ModifyDate / DateTime fallback
          ifd0DateTimeStr = readAsciiString(entryOffset);
        }
      }

      if (exifSubIfdOffset === -1 || exifSubIfdOffset + 2 > view.byteLength) return null;

      const subEntries = view.getUint16(exifSubIfdOffset, littleEndian);
      const result = {
        aperture: null,
        shutterSpeed: null,
        iso: null,
        exposureCompensation: null,
        focalLength: null,
        dateTimeOriginal: null,
        subSecTimeOriginal: null,
        timestampMs: null,
        formatted: '',
      };

      const readRational = (entryOffset) => {
        const valOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
        if (valOffset + 8 > view.byteLength) return null;
        const num = view.getUint32(valOffset, littleEndian);
        const den = view.getUint32(valOffset + 4, littleEndian);
        if (den === 0) return null;
        return num / den;
      };

      const readSRational = (entryOffset) => {
        const valOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
        if (valOffset + 8 > view.byteLength) return null;
        const num = view.getInt32(valOffset, littleEndian);
        const den = view.getInt32(valOffset + 4, littleEndian);
        if (den === 0) return null;
        return num / den;
      };

      for (let i = 0; i < subEntries; i++) {
        const entryOffset = exifSubIfdOffset + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tag = view.getUint16(entryOffset, littleEndian);

        if (tag === 0x829A) {
          // ExposureTime
          const valOffset = tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
          if (valOffset + 8 <= view.byteLength) {
            const num = view.getUint32(valOffset, littleEndian);
            const den = view.getUint32(valOffset + 4, littleEndian);
            if (den > 0 && num > 0) {
              if (num === 1) {
                result.shutterSpeed = `1/${den}s`;
              } else if (num < den) {
                result.shutterSpeed = `1/${Math.round(den / num)}s`;
              } else {
                const sec = num / den;
                result.shutterSpeed = sec >= 1 && sec % 1 === 0 ? `${sec}s` : `${sec.toFixed(1)}s`;
              }
            }
          }
        } else if (tag === 0x829D) {
          // FNumber
          const f = readRational(entryOffset);
          if (f !== null) {
            result.aperture = `f/${f % 1 === 0 ? f : f.toFixed(1)}`;
          }
        } else if (tag === 0x8827) {
          // ISOSpeedRatings
          const type = view.getUint16(entryOffset + 2, littleEndian);
          let isoVal = 0;
          if (type === 3) {
            // SHORT
            isoVal = view.getUint16(entryOffset + 8, littleEndian);
          } else if (type === 4) {
            // LONG
            isoVal = view.getUint32(entryOffset + 8, littleEndian);
          }
          if (isoVal > 0) {
            result.iso = `ISO ${isoVal}`;
          }
        } else if (tag === 0x9204) {
          // ExposureBiasValue (SRATIONAL)
          const ev = readSRational(entryOffset);
          if (ev !== null) {
            const rounded = Math.round(ev * 10) / 10;
            if (rounded === 0) {
              result.exposureCompensation = '0 EV';
            } else if (rounded > 0) {
              result.exposureCompensation = `+${rounded.toFixed(1)} EV`;
            } else {
              result.exposureCompensation = `${rounded.toFixed(1)} EV`;
            }
          }
        } else if (tag === 0x920A) {
          // FocalLength
          const fl = readRational(entryOffset);
          if (fl !== null) {
            result.focalLength = `${fl % 1 === 0 ? fl : fl.toFixed(1)}mm`;
          }
        } else if (tag === 0x9003 || (tag === 0x9004 && !result.dateTimeOriginal)) {
          // DateTimeOriginal (0x9003) or DateTimeDigitized (0x9004)
          result.dateTimeOriginal = readAsciiString(entryOffset);
        } else if (tag === 0x9291 || (tag === 0x9290 && !result.subSecTimeOriginal)) {
          // SubSecTimeOriginal (0x9291) or SubSecTime (0x9290)
          result.subSecTimeOriginal = readAsciiString(entryOffset);
        }
      }

      const rawDateStr = result.dateTimeOriginal || ifd0DateTimeStr;
      if (rawDateStr) {
        result.timestampMs = this.parseExifTimestamp(rawDateStr, result.subSecTimeOriginal);
      }

      const parts = [];
      if (result.aperture) parts.push(result.aperture);
      if (result.shutterSpeed) parts.push(result.shutterSpeed);
      if (result.iso) parts.push(result.iso);
      if (result.exposureCompensation) parts.push(result.exposureCompensation);
      if (result.focalLength) parts.push(result.focalLength);

      result.formatted = parts.join(' · ');
      return result;
    } catch (err) {
      console.warn('EXIF parse error:', err);
      return null;
    }
  }

  /**
   * Converts EXIF DateTimeOriginal ("YYYY:MM:DD HH:MM:SS") + optional SubSecTimeOriginal ("45")
   * into epoch milliseconds.
   */
  static parseExifTimestamp(dateStr, subSecStr = null) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const m = dateStr.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[\sT]+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = parseInt(m[6], 10);

    let ms = 0;
    const subSecCandidate = subSecStr || m[7];
    if (subSecCandidate) {
      const digits = String(subSecCandidate).replace(/\D/g, '');
      if (digits.length > 0) {
        ms = Math.round(parseFloat(`0.${digits}`) * 1000);
      }
    }

    const ts = Date.UTC(year, month, day, hour, min, sec, ms);
    return Number.isNaN(ts) ? null : ts;
  }
}
