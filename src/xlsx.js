// Classeur Excel (.xlsx) écrit sans bibliothèque : un .xlsx est un ZIP de quelques fichiers XML (norme Office Open XML).
// Utilisé par le tableur de Zado Pro (« Base de données ») pour tout exporter en un fichier, une feuille par collection,
// avec la ligne d'en-tête figée, des filtres et des montants au format « 12 500 FCFA ».
// workbook([{ name, rows: [[cell…]…], widths: [px…], freeze, filter }]) → Buffer
//   cellule : null | nombre | texte | { v, s } avec s = head | money | pct | title | muted
const zlib = require('zlib');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const STYLE = { head: 1, money: 2, pct: 3, title: 4, muted: 5 };
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function sheetXml(sh) {
  const rows = sh.rows || [];
  const ncol = Math.max(1, ...rows.map((r) => r.length));
  const cols = (sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.round((w || 100) / 6.5))}" customWidth="1"/>`).join('');
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    if (c == null || c === '') return '';
    const ref = colName(ci) + (ri + 1);
    const o = typeof c === 'object' ? c : { v: c };
    const s = o.s ? ` s="${STYLE[o.s] || 0}"` : '';
    if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const last = colName(ncol - 1) + Math.max(1, rows.length);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheetViews><sheetView workbookViewId="0"${sh.freeze ? '' : ' tabSelected="1"'}>${sh.freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="16"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${body}</sheetData>`
    + (sh.filter && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '')
    + '</worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0 &quot;FCFA&quot;"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>'
  + '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="15"/><color rgb="FF10264A"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF10264A"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

// ZIP minimal (méthode « deflate »), suffisant pour Excel, LibreOffice, Numbers et Google Sheets
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const dos = (() => { const d = new Date(); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; })();
  for (const [name, content] of files) {
    const raw = Buffer.from(content, 'utf8'), data = zlib.deflateRawSync(raw), crc = zlib.crc32(raw), fn = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(dos.time, 10); h.writeUInt16LE(dos.date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(fn.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(dos.time, 12); c.writeUInt16LE(dos.date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(fn.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, fn, data); central.push(c, fn);
    offset += h.length + fn.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function workbook(sheets) {
  const names = []; // noms uniques, 31 caractères au plus (règle d'Excel)
  for (const s of sheets) { let n = String(s.name || 'Feuille').slice(0, 31), i = 2; while (names.includes(n)) n = `${String(s.name).slice(0, 28)} ${i++}`; names.push(n); }
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
      + (sheets.some((s) => s.filter) ? `<definedNames>${sheets.map((s, i) => (s.filter && s.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : '')).join('')}</definedNames>` : '')
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files);
}

module.exports = { workbook, colName };
