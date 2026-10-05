import { Router } from 'express';
import { pool, q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Auto-cancel expired reservations (spec 1.7.1.4 - the "technological
 * challenge"): flips reservation to 'expired' and the book back to
 * 'available', and queues a notification to the student.
 * Runs on server boot and every 10 minutes (see startReservationSweeper).
 */
export async function sweepExpiredReservations() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [expired] = await conn.query(
      `SELECT r.id, r.book_id, r.student_user_id, b.title
       FROM reservations r JOIN books b ON b.id = r.book_id
       WHERE r.status = 'active' AND r.expires_at < NOW()
       FOR UPDATE`
    );
    for (const r of expired) {
      await conn.query(
        "UPDATE reservations SET status = 'expired' WHERE id = ?", [r.id]
      );
      await conn.query(
        "UPDATE books SET status = 'available' WHERE id = ? AND status = 'reserved'",
        [r.book_id]
      );
      await conn.query(
        `INSERT INTO notifications (user_id, channel, template, payload)
         VALUES (?, (SELECT setting_value FROM settings WHERE setting_key='default_channel'),
                 'reservation_expired', ?)`,
        [r.student_user_id, JSON.stringify({ book: r.title })]
      );
    }
    await conn.commit();
    return expired.length;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Start the periodic sweeper (called from index.js) */
export function startReservationSweeper(intervalMinutes = 10) {
  sweepExpiredReservations().catch((e) =>
    console.error('reservation sweep failed:', e.message)
  );
  setInterval(() => {
    sweepExpiredReservations().catch((e) =>
      console.error('reservation sweep failed:', e.message)
    );
  }, intervalMinutes * 60 * 1000);
}

/**
 * POST /api/reservations  { barcode }
 * Student reserves an available book. Expiry = now + reservation_hours
 * (from settings, default 48). One active reservation per student per book.
 */
router.post(
  '/',
  requireAuth,
  requireRole('student'),
  asyncH(async (req, res) => {
    const { barcode } = req.body || {};
    if (!barcode) return res.status(400).json({ error: 'יש לציין ברקוד ספר' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [books] = await conn.query(
        'SELECT * FROM books WHERE barcode = ? FOR UPDATE', [barcode]
      );
      const book = books[0];
      if (!book) throw httpErr(404, 'ספר לא נמצא');
      if (book.status !== 'available') {
        const label = { loaned: 'מושאל', reserved: 'משוריין', damaged: 'פגום', removed: 'הוסר' }[book.status] || book.status;
        throw httpErr(409, `לא ניתן לשריין - הספר ${label}`);
      }

      const [[{ debts }]] = await conn.query(
        'SELECT COUNT(*) AS debts FROM debts WHERE student_user_id = ? AND settled_at IS NULL',
        [req.user.id]
      );
      if (debts > 0) throw httpErr(409, 'לא ניתן לשריין - קיים חוב פתוח');

      const [[{ hours }]] = await conn.query(
        "SELECT CAST(setting_value AS UNSIGNED) AS hours FROM settings WHERE setting_key = 'reservation_hours'"
      );
      const h = hours || 48;

      const [ins] = await conn.query(
        `INSERT INTO reservations (book_id, student_user_id, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
        [book.id, req.user.id, h]
      );
      await conn.query("UPDATE books SET status = 'reserved' WHERE id = ?", [book.id]);

      await conn.query(
        `INSERT INTO notifications (user_id, channel, template, payload)
         VALUES (?, (SELECT setting_value FROM settings WHERE setting_key='default_channel'),
                 'reservation_confirm', ?)`,
        [req.user.id, JSON.stringify({ book: book.title, hours: h })]
      );

      await conn.commit();
      res.status(201).json({
        reservation_id: ins.insertId,
        book: book.title,
        expires_in_hours: h,
        message: `הספר שוריין ל-${h} שעות - יש לאסוף מהספרייה`,
      });
    } catch (e) {
      await conn.rollback();
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    } finally {
      conn.release();
    }
  })
);

/** GET /api/reservations/my - student's reservations */
router.get(
  '/my',
  requireAuth,
  requireRole('student'),
  asyncH(async (req, res) => {
    const rows = await q(
      `SELECT r.id, b.barcode, b.title, b.author, b.shelf_location,
              r.reserved_at, r.expires_at, r.status,
              GREATEST(TIMESTAMPDIFF(MINUTE, NOW(), r.expires_at), 0) AS minutes_left
       FROM reservations r JOIN books b ON b.id = r.book_id
       WHERE r.student_user_id = ?
       ORDER BY r.reserved_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

/**
 * GET /api/reservations/active - librarian/management: all active
 * reservations with requester details (name, class, phone) so staff can
 * see who is waiting for which book and reach them directly.
 * Supports ?q= to search by student name, book title, or exact barcode.
 */
router.get(
  '/active',
  requireAuth,
  requireRole('librarian', 'management'),
  asyncH(async (req, res) => {
    const term = (req.query.q || '').trim();
    const where = ["r.status = 'active'"];
    const params = [];
    if (term) {
      where.push('(u.full_name LIKE ? OR b.title LIKE ? OR b.barcode = ?)');
      params.push(`%${term}%`, `%${term}%`, term);
    }

    const rows = await q(
      `SELECT r.id, b.barcode, b.title, b.shelf_location,
              u.id AS student_id, u.full_name AS student_name, u.phone,
              s.student_number, s.class_name,
              r.reserved_at, r.expires_at,
              GREATEST(TIMESTAMPDIFF(MINUTE, NOW(), r.expires_at), 0) AS minutes_left
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       JOIN users u ON u.id = r.student_user_id
       JOIN students s ON s.user_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY r.expires_at ASC`,
      params
    );
    res.json(rows);
  })
);

/** DELETE /api/reservations/:id - student cancels own active reservation */
router.delete(
  '/:id',
  requireAuth,
  requireRole('student'),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT * FROM reservations
         WHERE id = ? AND student_user_id = ? AND status = 'active'
         FOR UPDATE`,
        [id, req.user.id]
      );
      const r = rows[0];
      if (!r) throw httpErr(404, 'שריון פעיל לא נמצא');

      await conn.query("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [id]);
      await conn.query(
        "UPDATE books SET status = 'available' WHERE id = ? AND status = 'reserved'",
        [r.book_id]
      );
      await conn.commit();
      res.json({ message: 'השריון בוטל' });
    } catch (e) {
      await conn.rollback();
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    } finally {
      conn.release();
    }
  })
);

export default router;
