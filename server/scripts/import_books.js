/**
 * Bulk book importer.
 * Usage: node scripts/import_books.js books.csv
 *
 * Expects a CSV (comma-separated, UTF-8) with header row and columns:
 *   barcode, title, author, genre, shelf_location, isbn, publish_year
 * (matches the columns in books_template.xlsx after "Save As CSV UTF-8")
 *
 * - barcode may be left blank -> auto-generated as BK-00NN (next free number)
 * - genre must be one of: study, science, literature, history, technology, other
 *   (blank or invalid -> "other", with a warning)
 * - duplicate barcode/isbn -> row is skipped with a warning, import continues
 */
import fs from 'fs';
import { pool } from '../src/db.js';

const GENRES = ['study', 'science', 'literature', 'history', 'technology', 'other'];

/** Minimal RFC4180 CSV parser: handles quoted fields, embedded commas/quotes. */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM (Excel adds this)
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip; \n handles the line break
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

async function nextBarcode(conn, used) {
  const [rows] = await conn.query(
    `SELECT barcode FROM books WHERE barcode LIKE 'BK-%' ORDER BY barcode DESC LIMIT 1`
  );
  let n = 1;
  if (rows[0]) {
    const m = rows[0].barcode.match(/BK-(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  let candidate;
  do {
    candidate = `BK-${String(n).padStart(4, '0')}`;
    n++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import_books.js <books.csv>');
    process.exit(1);
  }
  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCSV(text);
  const header = rows.shift().map((h) => h.trim().toLowerCase());

  const idx = {
    barcode: header.findIndex((h) => h.includes('ברקוד') || h === 'barcode'),
    title: header.findIndex((h) => h.includes('שם הספר') || h === 'title'),
    author: header.findIndex((h) => h.includes('מחבר') || h === 'author'),
    genre: header.findIndex((h) => h.includes("ז'אנר") || h.includes('ז׳אנר') || h === 'genre'),
    shelf: header.findIndex((h) => h.includes('מדף') || h === 'shelf_location'),
    isbn: header.findIndex((h) => h.includes('isbn')),
    year: header.findIndex((h) => h.includes('שנת') || h === 'publish_year'),
  };
  if (idx.title === -1 || idx.shelf === -1) {
    console.error('CSV is missing required columns (title / shelf location). Check the header row.');
    process.exit(1);
  }

  const conn = await pool.getConnection();
  const usedBarcodes = new Set();
  let inserted = 0, skipped = 0;

  try {
    for (const [i, r] of rows.entries()) {
      const title = (r[idx.title] || '').trim();
      const shelf = (r[idx.shelf] || '').trim();
      if (!title || !shelf) {
        console.warn(`Row ${i + 2}: missing title or shelf location — skipped`);
        skipped++;
        continue;
      }
      const author = idx.author >= 0 ? (r[idx.author] || '').trim() : '';
      let genre = idx.genre >= 0 ? (r[idx.genre] || '').trim().toLowerCase() : '';
      if (!GENRES.includes(genre)) {
        if (genre) console.warn(`Row ${i + 2}: unknown genre "${genre}" — defaulting to "other"`);
        genre = 'other';
      }
      const isbn = idx.isbn >= 0 ? (r[idx.isbn] || '').trim() : '';
      const yearRaw = idx.year >= 0 ? (r[idx.year] || '').trim() : '';
      const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;

      let barcode = idx.barcode >= 0 ? (r[idx.barcode] || '').trim() : '';
      if (!barcode) {
        barcode = await nextBarcode(conn, usedBarcodes);
      } else {
        usedBarcodes.add(barcode);
        const [dup] = await conn.query('SELECT id FROM books WHERE barcode = ?', [barcode]);
        if (dup.length) {
          console.warn(`Row ${i + 2}: barcode ${barcode} already exists — skipped`);
          skipped++;
          continue;
        }
      }

      if (isbn) {
        const [dupIsbn] = await conn.query('SELECT id FROM books WHERE isbn = ? AND isbn != ""', [isbn]);
        if (dupIsbn.length) {
          console.warn(`Row ${i + 2}: ISBN ${isbn} already exists (barcode ${dupIsbn[0].id}) — importing anyway (duplicate copies are allowed)`);
        }
      }

      await conn.query(
        `INSERT INTO books (barcode, isbn, title, author, genre, shelf_location, publish_year, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`,
        [barcode, isbn || null, title, author || null, genre, shelf, year]
      );
      inserted++;
    }
  } finally {
    conn.release();
  }

  console.log(`\nDone. Inserted: ${inserted}, skipped: ${skipped}, total rows read: ${rows.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Import failed:', e.message);
  process.exit(1);
});
