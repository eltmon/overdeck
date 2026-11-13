/** PAN-5189 WI-4: openDocument reads ODF text and spreadsheet content, with openEpub/openRtf/openNotebook dropped. */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { openDocument } from '../extendedDocumentPreview';

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';

describe('openDocument', () => {
  it('reads an odt paragraph into a document page', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    zip.file(
      'content.xml',
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body><office:text><text:p>Hello ODF</text:p></office:text></office:body></office:document-content>`,
    );
    const result = await openDocument(zip, 'odt');
    expect(result.type).toBe('document');
    if (result.type !== 'document') throw new Error('expected a document result');
    expect(result.pages[0]?.html).toContain('Hello ODF');
  });

  it('reads an ods sheet into named rows and columns', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
    zip.file(
      'content.xml',
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
    );
    const result = await openDocument(zip, 'ods');
    expect(result.type).toBe('ods');
    if (result.type !== 'ods') throw new Error('expected an ods result');
    expect(result.sheets[0]?.name).toBe('Sheet1');
    expect(result.sheets[0]?.rows[0]).toEqual(['a', 'b']);
  });
});
