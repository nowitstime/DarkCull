/**
 * darktable XMP Sidecar Generator and Parser
 */

export class XmpBuilder {
  /**
   * Generates a minimal darktable-compatible XMP XML string.
   * @param {number} rating - -1 (reject), 0 (unrated), 1..5 (stars)
   * @returns {string}
   */
  static generateMinimalXmp(rating) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 4.4.0-Exiv2">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="${rating}"/>
 </rdf:RDF>
</x:xmpmeta>`;
  }

  /**
   * Parses xmp:Rating from an XMP string.
   * Note: darktable writes xmp:Rating="1" by default on import when an image has not been rated
   * in DarkCull (which uses -1 = Reject, 0 = Unrated, 3, 4, 5 = Stars).
   * If forceExact is false, ratings of 1 or 2 without a DarkCull tag default to 0 (Unrated)
   * unless explicitly set, or we can check if it's in { -1, 3, 4, 5 }.
   * @param {string} xmlString
   * @returns {number}
   */
  static parseRating(xmlString) {
    if (!xmlString) return 0;

    let rawRating = 0;

    // Fast regex search for xmp:Rating="..." or Rating="..."
    const attrMatch = xmlString.match(/xmp:Rating\s*=\s*["'](-?\d+)["']/i);
    if (attrMatch) {
      rawRating = parseInt(attrMatch[1], 10);
    } else {
      // Try tag format: <xmp:Rating>-1</xmp:Rating>
      const tagMatch = xmlString.match(/<xmp:Rating>\s*(-?\d+)\s*<\/xmp:Rating>/i);
      if (tagMatch) {
        rawRating = parseInt(tagMatch[1], 10);
      } else {
        // Fallback using DOMParser if in browser
        if (typeof DOMParser !== 'undefined') {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlString, "application/xml");
            const desc = doc.querySelector("Description");
            if (desc && desc.hasAttribute("xmp:Rating")) {
              rawRating = parseInt(desc.getAttribute("xmp:Rating"), 10);
            }
          } catch (e) {
            console.warn("DOMParser failed to parse XMP rating:", e);
          }
        }
      }
    }

    if (isNaN(rawRating)) return 0;
    // Darktable initializes newly imported photos with xmp:Rating="1".
    // Since DarkCull workflow uses Unrated (0), ★3, ★4, ★5, and Rejected (-1),
    // treat 1 and 2 as Unrated (0) so existing darktable folders show up in "Unrated" properly.
    if (rawRating === 1 || rawRating === 2) {
      return 0;
    }
    return rawRating;
  }

  /**
   * Non-destructively patches the rating in an existing XMP document,
   * preserving all darktable:history, tags, metadata, and namespaces.
   * @param {string} originalXml - Original XMP XML string
   * @param {number} newRating - New rating (-1, 0, 1..5)
   * @returns {string}
   */
  static patchRating(originalXml, newRating) {
    if (!originalXml || !originalXml.trim()) {
      return this.generateMinimalXmp(newRating);
    }

    // 1. Check if xmp:Rating="..." attribute already exists in rdf:Description
    const attrRegex = /(xmp:Rating\s*=\s*["'])(-?\d+)(["'])/i;
    if (attrRegex.test(originalXml)) {
      return originalXml.replace(attrRegex, `$1${newRating}$3`);
    }

    // 2. Check if <xmp:Rating>...</xmp:Rating> tag exists
    const tagRegex = /(<xmp:Rating\s*>)(-?\d+)(<\/xmp:Rating>)/i;
    if (tagRegex.test(originalXml)) {
      return originalXml.replace(tagRegex, `$1${newRating}$3`);
    }

    // 3. If xmp:Rating is not yet present, insert xmp:Rating into the primary <rdf:Description> tag
    const descTagRegex = /(<rdf:Description\b[^>]*?)(\/?>)/i;
    const descMatch = originalXml.match(descTagRegex);
    if (descMatch) {
      const beforeClose = descMatch[1];
      const closeBracket = descMatch[2];

      // Make sure xmp namespace is declared if not already
      let namespaceInsert = '';
      if (!/xmlns:xmp=/i.test(originalXml)) {
        namespaceInsert = ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"';
      }

      const replacement = `${beforeClose}${namespaceInsert} xmp:Rating="${newRating}"${closeBracket}`;
      return originalXml.replace(descTagRegex, replacement);
    }

    // Fallback: If structure is malformed or unrecognised, generate minimal XMP
    return this.generateMinimalXmp(newRating);
  }

  /**
   * Determines target sidecar filename based on darktable naming convention.
   * Defaults to [RAW_FILENAME].xmp (e.g. P1010234.RW2.xmp).
   * If no raw file exists, uses [JPEG_FILENAME].xmp.
   * @param {string} rawName
   * @param {string} jpegName
   * @returns {string}
   */
  static determineSidecarName(rawName, jpegName) {
    if (rawName) {
      return `${rawName}.xmp`;
    }
    if (jpegName) {
      return `${jpegName}.xmp`;
    }
    return 'sidecar.xmp';
  }
}
