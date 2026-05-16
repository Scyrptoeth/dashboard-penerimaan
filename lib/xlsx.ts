import type { CanonicalRecord } from "./domain";
import { RECORD_EXPORT_HEADERS, recordToExportRow } from "./record-display";

type ZipFile = {
  name: string;
  bytes: Uint8Array;
};

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEXT_ENCODER = new TextEncoder();
const CRC_TABLE = buildCrcTable();

export function getRecordsXlsxRows(records: CanonicalRecord[]): string[][] {
  return [[...RECORD_EXPORT_HEADERS], ...records.map(recordToExportRow)];
}

export function buildRecordsXlsxBlob(records: CanonicalRecord[], createdAt = new Date()): Blob {
  const rows = getRecordsXlsxRows(records);
  const columnWidths = calculateColumnWidths(rows);
  const files = [
    textFile("[Content_Types].xml", contentTypesXml()),
    textFile("_rels/.rels", rootRelationshipsXml()),
    textFile("docProps/app.xml", appPropertiesXml()),
    textFile("docProps/core.xml", corePropertiesXml(createdAt)),
    textFile("xl/workbook.xml", workbookXml()),
    textFile("xl/_rels/workbook.xml.rels", workbookRelationshipsXml()),
    textFile("xl/styles.xml", stylesXml()),
    textFile("xl/worksheets/sheet1.xml", worksheetXml(rows, columnWidths)),
  ];

  return new Blob([createZip(files)], { type: MIME_XLSX });
}

function worksheetXml(rows: string[][], columnWidths: number[]) {
  return xmlDocument(`\
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <cols>
${columnWidths.map((width, index) => `    <col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("\n")}
  </cols>
  <sheetData>
${rows.map((row, rowIndex) => worksheetRowXml(row, rowIndex + 1, columnWidths)).join("\n")}
  </sheetData>
</worksheet>`);
}

function worksheetRowXml(row: string[], rowNumber: number, columnWidths: number[]) {
  const rowHeight = calculateRowHeight(row, columnWidths);
  const cells = row
    .map((value, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
      const style = rowNumber === 1 ? 1 : 2;
      return `      <c r="${reference}" t="inlineStr" s="${style}"><is><t>${escapeXml(value)}</t></is></c>`;
    })
    .join("\n");

  return `    <row r="${rowNumber}" ht="${rowHeight}" customHeight="1">\n${cells}\n    </row>`;
}

function calculateColumnWidths(rows: string[][]) {
  const minimums = [20, 18, 26, 16, 13, 16, 16, 18, 18];
  const maximums = [32, 20, 34, 18, 16, 18, 18, 20, 20];

  return RECORD_EXPORT_HEADERS.map((_, index) => {
    const longest = Math.max(...rows.map((row) => displayLength(row[index] ?? "")));
    const width = Math.ceil(longest * 1.08) + 2;
    return Math.min(maximums[index] ?? 24, Math.max(minimums[index] ?? 12, width));
  });
}

function calculateRowHeight(row: string[], columnWidths: number[]) {
  const maxLines = row.reduce((currentMax, value, index) => {
    const width = Math.max(columnWidths[index] ?? 12, 8);
    return Math.max(currentMax, Math.ceil(displayLength(value) / width));
  }, 1);

  return Math.min(72, Math.max(20, maxLines * 16));
}

function displayLength(value: string) {
  return value.replace(/[^\x00-\xff]/g, "xx").length;
}

function columnName(index: number) {
  let column = "";
  let current = index;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    current = Math.floor((current - 1) / 26);
  }

  return column;
}

function contentTypesXml() {
  return xmlDocument(`\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
}

function rootRelationshipsXml() {
  return xmlDocument(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
}

function workbookRelationshipsXml() {
  return xmlDocument(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function workbookXml() {
  return xmlDocument(`\
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Dashboard Penerimaan" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`);
}

function stylesXml() {
  return xmlDocument(`\
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><name val="Arial"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0EBE1"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFDDD5C7"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`);
}

function appPropertiesXml() {
  return xmlDocument(`\
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Dashboard Penerimaan</Application>
</Properties>`);
}

function corePropertiesXml(createdAt: Date) {
  const timestamp = createdAt.toISOString();
  return xmlDocument(`\
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Dashboard Penerimaan</dc:creator>
  <cp:lastModifiedBy>Dashboard Penerimaan</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`);
}

function xmlDocument(content: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${content}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textFile(name: string, content: string): ZipFile {
  return { name, bytes: TEXT_ENCODER.encode(content) };
}

function createZip(files: ZipFile[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = TEXT_ENCODER.encode(file.name);
    const crc = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeLocalHeader(localView, file.bytes.length, crc);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeCentralHeader(centralView, file.bytes.length, crc, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.bytes.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, centralDirectoryOffset, true);

  return concatBytes([...localParts, ...centralParts, endRecord]);
}

function writeLocalHeader(view: DataView, size: number, crc: number) {
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, view.byteLength - 30, true);
}

function writeCentralHeader(view: DataView, size: number, crc: number, offset: number) {
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, view.byteLength - 46, true);
  view.setUint32(42, offset, true);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function buildCrcTable() {
  return Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
