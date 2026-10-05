import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const GENRES = ['study', 'science', 'literature', 'history', 'technology', 'other'];
const STATUSES = ['available', 'loaned', 'reserved', 'damaged', 'removed'];

/**
 * GET /api/books/search?q=&genre=&status=&page=
 * Catalog search - students see everything except 'removed';
 * librarian can filter any status (inventory view uses the same endpoint).
 */
router.get(
  '/search',
  requireAuth,
  asyncH(async (req, res) => {
    const term = (req.query.q || '').trim();
    const genre = (req.query.genre || '').trim();
    const status = (req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const PAGE_SIZE = 20;

    const where = [];
    const params = [];

    if (req.user.role === 'student') {
      where.push("status != 'removed'");
    } else if (status && STATUSES.includes(status)) {
      where.push('status = ?');
      params.push(status);
    }
    if (term) {
      where.push('(title LIKE ? OR author LIKE ? OR barcode = ? OR isbn = ?)');
      params.push(`%${term}%`, `%${term}%`, term, term);
    }
    if (genre && GENRES.includes(genre)) {
      where.push('genre = ?');
      params.push(genre);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await q(`SELECT COUNT(*) AS total FROM books ${whereSql}`, params);
    const rows = await q(
      `SELECT id, barcode, isbn, title, author, genre, shelf_location,
              publish_year, status, notes
       FROM books ${whereSql}
       ORDER BY title ASC
       LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params
    );
    res.json({ total, page, page_size: PAGE_SIZE, books: rows });
  })
);

/**
 * POST /api/books - add a new copy to inventory (librarian).
 */
router.post(
  '/',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const { barcode, isbn, title, author, genre, shelf_location, publish_year, notes } =
      req.body || {};
    if (!barcode || !title || !shelf_location) {
      return res.status(400).json({ error: 'ברקוד, שם ספר ומיקום מדף הם שדות חובה' });
    }
    if (genre && !GENRES.includes(genre)) {
      return res.status(400).json({ error: 'ז\'אנר לא תקין' });
    }
    const dup = await q('SELECT id FROM books WHERE barcode = ?', [barcode]);
    if (dup.length) return res.status(409).json({ error: 'ברקוד כבר קיים במערכת' });

    const r = await q(
      `INSERT INTO books (barcode, isbn, title, author, genre, shelf_location, publish_year, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [barcode, isbn || null, title, author || null, genre || 'other',
       shelf_location, publish_year || null, notes || null]
    );
    res.status(201).json({ id: r.insertId, message: 'הספר נוסף למלאי' });
  })
);

/**
 * PUT /api/books/:id - edit book details / fix status (librarian).
 * Status changes allowed here: damaged->available (after repair),
 * available<->damaged, and -> removed (soft delete).
 * loaned/reserved statuses are managed only by the loan/reservation flows.
 */
router.put(
  '/:id',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await q('SELECT * FROM books WHERE id = ?', [id]);
    const book = rows[0];
    if (!book) return res.status(404).json({ error: 'ספר לא נמצא' });

    const { title, author, genre, shelf_location, publish_year, isbn, notes, status } =
      req.body || {};

    if (status && status !== book.status) {
      const manual = ['available', 'damaged', 'removed'];
      if (!manual.includes(status) || !manual.includes(book.status)) {
        return res.status(409).json({
          error: 'לא ניתן לשנות ידנית סטטוס השאלה/שריון - השתמשו בתהליכי ההשאלה וההחזרה',
        });
      }
    }
    if (genre && !GENRES.includes(genre)) {
      return res.status(400).json({ error: 'ז\'אנר לא תקין' });
    }

    await q(
      `UPDATE books SET
         title = ?, author = ?, genre = ?, shelf_location = ?,
         publish_year = ?, isbn = ?, notes = ?, status = ?
       WHERE id = ?`,
      [
        title ?? book.title,
        author ?? book.author,
        genre ?? book.genre,
        shelf_location ?? book.shelf_location,
        publish_year ?? book.publish_year,
        isbn ?? book.isbn,
        notes ?? book.notes,
        status ?? book.status,
        id,
      ]
    );
    res.json({ message: 'הספר עודכן' });
  })
);

export default router;
