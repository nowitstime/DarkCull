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
   * Defaults to 0 if not present or cannot be parsed.
   * @param {string} xmlString
   * @returns {number}
   */
  static parseRating(xmlString) {
    if (!xmlString) return 0;

    // Fast regex search for xmp:Rating="..." or Rating="..."
    const attrMatch = xmlString.match(/xmp:Rating\s*=\s*["'](-?\d+)["']/i);
    if (attrMatch) {
      return parseInt(attrMatch[1], 10);
    }

    // Try tag format: <xmp:Rating>-1</xmp:Rating>
    const tagMatch = xmlString.match(/<xmp:Rating>\s*(-?\d+)\s*<\/xmp:Rating>/i);
    if (tagMatch) {
      return parseInt(tagMatch[1], 10);
    }

    // Fallback using DOMParser if in browser
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, "application/xml");
      const desc = doc.querySelector("Description");
      if (desc && desc.hasAttribute("xmp:Rating")) {
        return parseInt(desc.getAttribute("xmp:Rating"), 10);
      }
    } catch (e) {
      console.warn("DOMParser failed to parse XMP rating:", e);
    }

    return 0;
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
