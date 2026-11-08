import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XmpBuilder } from '../js/xmpBuilder.js';

describe('XmpBuilder', () => {
  describe('generateMinimalXmp', () => {
    it('generates valid minimal XMP for 5 stars', () => {
      const xml = XmpBuilder.generateMinimalXmp(5);
      assert.ok(xml.includes('xmp:Rating="5"'));
      assert.ok(xml.includes('<rdf:RDF'));
      assert.ok(xml.includes('xmlns:xmp="http://ns.adobe.com/xap/1.0/"'));
    });

    it('generates valid minimal XMP for rejected (-1)', () => {
      const xml = XmpBuilder.generateMinimalXmp(-1);
      assert.ok(xml.includes('xmp:Rating="-1"'));
    });

    it('generates valid minimal XMP for unrated (0)', () => {
      const xml = XmpBuilder.generateMinimalXmp(0);
      assert.ok(xml.includes('xmp:Rating="0"'));
    });
  });

  describe('parseRating', () => {
    it('parses attribute format xmp:Rating="4"', () => {
      const xml = '<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4"/>';
      assert.equal(XmpBuilder.parseRating(xml), 4);
    });

    it('parses single-quote attribute xmp:Rating=\'3\'', () => {
      const xml = '<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating=\'3\'/>';
      assert.equal(XmpBuilder.parseRating(xml), 3);
    });

    it('parses tag format <xmp:Rating>5</xmp:Rating>', () => {
      const xml = '<rdf:Description><xmp:Rating>5</xmp:Rating></rdf:Description>';
      assert.equal(XmpBuilder.parseRating(xml), 5);
    });

    it('parses rejected rating (-1)', () => {
      const xml = '<rdf:Description xmp:Rating="-1"/>';
      assert.equal(XmpBuilder.parseRating(xml), -1);
    });

    it('normalizes darktable default 1 rating to 0 (Unrated)', () => {
      const dtDefaultXml = `
        <rdf:Description rdf:about=""
          xmlns:xmp="http://ns.adobe.com/xap/1.0/"
          xmp:Rating="1"/>
      `;
      assert.equal(XmpBuilder.parseRating(dtDefaultXml), 0);
    });

    it('normalizes darktable legacy 2 rating to 0 (Unrated)', () => {
      const xml = '<rdf:Description xmp:Rating="2"/>';
      assert.equal(XmpBuilder.parseRating(xml), 0);
    });

    it('returns 0 for empty or invalid XML', () => {
      assert.equal(XmpBuilder.parseRating(''), 0);
      assert.equal(XmpBuilder.parseRating(null), 0);
      assert.equal(XmpBuilder.parseRating('not xml content'), 0);
    });
  });

  describe('patchRating', () => {
    it('non-destructively replaces attribute rating while keeping existing tags and history', () => {
      const original = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:darktable="http://darktable.sf.net/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="0"
    darktable:colorlabels="1">
   <darktable:history>
    <rdf:Seq>
     <rdf:li darktable:operation="exposure" darktable:enabled="1"/>
    </rdf:Seq>
   </darktable:history>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

      const patched = XmpBuilder.patchRating(original, 5);
      assert.ok(patched.includes('xmp:Rating="5"'));
      assert.ok(!patched.includes('xmp:Rating="0"'));
      assert.ok(patched.includes('darktable:colorlabels="1"'));
      assert.ok(patched.includes('<darktable:history>'));
      assert.ok(patched.includes('darktable:operation="exposure"'));
    });

    it('patches tag format <xmp:Rating>3</xmp:Rating> to <xmp:Rating>-1</xmp:Rating>', () => {
      const original = '<rdf:Description><xmp:Rating>3</xmp:Rating></rdf:Description>';
      const patched = XmpBuilder.patchRating(original, -1);
      assert.equal(patched, '<rdf:Description><xmp:Rating>-1</xmp:Rating></rdf:Description>');
    });

    it('inserts xmp:Rating and xmlns:xmp namespace when absent in Description', () => {
      const original = '<rdf:RDF><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"></rdf:Description></rdf:RDF>';
      const patched = XmpBuilder.patchRating(original, 4);
      assert.ok(patched.includes('xmp:Rating="4"'));
      assert.ok(patched.includes('xmlns:xmp="http://ns.adobe.com/xap/1.0/"'));
    });

    it('falls back to minimal XMP if original is empty', () => {
      const patched = XmpBuilder.patchRating('', 3);
      assert.ok(patched.includes('xmp:Rating="3"'));
    });
  });

  describe('determineSidecarName', () => {
    it('prefers rawName when both raw and jpeg exist', () => {
      assert.equal(XmpBuilder.determineSidecarName('P1010234.RW2', 'P1010234.JPG'), 'P1010234.RW2.xmp');
    });

    it('uses jpegName when no raw file exists', () => {
      assert.equal(XmpBuilder.determineSidecarName(null, 'IMG_1234.JPG'), 'IMG_1234.JPG.xmp');
    });

    it('falls back to sidecar.xmp when neither is provided', () => {
      assert.equal(XmpBuilder.determineSidecarName(null, null), 'sidecar.xmp');
    });
  });
});
