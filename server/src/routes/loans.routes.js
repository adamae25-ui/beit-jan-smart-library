import { Router } from 'express';
import { pool, q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Read a numeric setting with fallback */
async function getSetting(conn, key, fallback) {
  const [rows] = await conn.query(
    'SELECT setting_value FROM settings WHERE setting_key = ?', [key]
  );
  return rows[0] ? rows[0].setting_value : fallback;
}

/** Queue a notification (actual sending: Phase 4 worker) */
async function queueNotification(conn, userId, template, payload) {
  const channel = await getSetting(conn, 'default_channel', 'whatsapp');
  await conn.query(
    `INSERT INTO notifications (user_id, channel, template, payload)
     VALUES (?, ?, ?, ?)`,
    [userId, channel, template, JSON.stringify(payload)]
  );
}

/**
 * POST /api/loans   { student_user_id, barcode }
 * Full loan flow (spec 1.7.1):
 *  - verify student eligibility (no open debt, under quota)   1.7.1.1-3
 *  - verify book is available (or reserved BY this student)   1.7.1.5-6
 *  - due date auto-calculated per genre from settings         1.7.1.7
 *  - create loan, flip book status, fulfill reservation
 *  - queue confirmation notification                          1.7.1.8
 * Everything in one transaction with row locks (no double-loan).
 */
router.post(
  '/',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const { student_user_id, barcode } = req.body || {};
    if (!student_user_id || !barcode) {
      return res.status(400).json({ error: 'חסרים פרטי תלמיד או ברקוד' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // --- Student eligibility (lock student row set) ---
      const [students] = await conn.query(
        `SELECT u.id, u.full_name, s.max_loans
         FROM users u JOIN students s ON s.user_id = u.id
         WHERE u.id = ? AND u.role = 'student' AND u.status = 'active'
         FOR UPDATE`,
        [student_user_id]
      );
      const student = students[0];
      if (!student) throw httpErr(404, 'תלמיד לא נמצא או אינו פעיל');

      const [[{ debts }]] = await conn.query(
        `SELECT COUNT(*) AS debts FROM debts
         WHERE student_user_id = ? AND settled_at IS NULL`,
        [student.id]
      );
      if (debts > 0) throw httpErr(409, 'לתלמיד חוב פתוח - לא ניתן להשאיל');

      const [[{ activeLoans }]] = await conn.query(
        `SELECT COUNT(*) AS activeLoans FROM loans
         WHERE student_user_id = ? AND returned_at IS NULL`,
        [student.id]
      );
      if (activeLoans >= student.max_loans) {
        throw httpErr(409, `התלמיד הגיע למכסת ההשאלות (${student.max_loans})`);
      }

      // --- Book availability (lock the book row) ---
      const [books] = await conn.query(
        'SELECT * FROM books WHERE barcode = ? FOR UPDATE', [barcode]
      );
      const book = books[0];
      if (!book) throw httpErr(404, 'ברקוד לא נמצא במערכת');

      let reservationToFulfill = null;
      if (book.status === 'reserved') {
        const [rs] = await conn.query(
          `SELECT * FROM reservations
           WHERE book_id = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
          [book.id]
        );
        const r = rs[0];
        if (r && r.student_user_id !== student.id) {
          throw httpErr(409, 'הספר משוריין לתלמיד אחר');
        }
        reservationToFulfill = r || null;
      } else if (book.status !== 'available') {
        const label = { loaned: 'מושאל', damaged: 'פגום', removed: 'הוסר מהמלאי' }[book.status] || book.status;
        throw httpErr(409, `לא ניתן להשאיל - הספר ${label}`);
      }

      // --- Due date per genre (spec 1.7.1.7) ---
      const days = Number(await getSetting(conn, `loan_days_${book.genre}`, 14));
      const [[{ due }]] = await conn.query(
        'SELECT DATE_ADD(CURDATE(), INTERVAL ? DAY) AS due', [days]
      );

      // --- Create loan + update statuses ---
      const [ins] = await conn.query(
        `INSERT INTO loans (book_id, student_user_id, librarian_id, due_date)
         VALUES (?, ?, ?, ?)`,
        [book.id, student.id, req.user.id, due]
      );
      await conn.query('UPDATE books SET status = "loaned" WHERE id = ?', [book.id]);
      if (reservationToFulfill) {
        await conn.query(
          'UPDATE reservations SET status = "fulfilled" WHERE id = ?',
          [reservationToFulfill.id]
        );
      }

      await queueNotification(conn, student.id, 'loan_confirm', {
        book: book.title, barcode: book.barcode, due_date: due,
      });

      await conn.commit();
      res.status(201).json({
        loan_id: ins.insertId,
        student: student.full_name,
        book: book.title,
        barcode: book.barcode,
        due_date: due,
        message: 'ההשאלה בוצעה בהצלחה',
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

/**
 * POST /api/loans/return   { barcode, condition, notes }
 * Full return flow (spec 1.7.2):
 *  - find active loan by barcode                       1.7.2.1
 *  - compute overdue days                              1.7.2.2
 *  - record condition; damage/overdue creates a debt   1.7.2.3-4
 *  - book back to available (or damaged)
 *  - queue return confirmation                          1.7.2.5
 */
router.post(
  '/return',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const { barcode, condition = 'ok', notes = null } = req.body || {};
    if (!barcode) return res.status(400).json({ error: 'יש להזין ברקוד' });

    const VALID = ['ok', 'partially_torn', 'badly_damaged', 'missing_pages'];
    if (!VALID.includes(condition)) {
      return res.status(400).json({ error: 'מצב ספר לא תקין' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [books] = await conn.query(
        'SELECT * FROM books WHERE barcode = ? FOR UPDATE', [barcode]
      );
      const book = books[0];
      if (!book) throw httpErr(404, 'ברקוד לא נמצא במערכת');

      const [loans] = await conn.query(
        `SELECT l.*, u.full_name AS student_name
         FROM loans l JOIN users u ON u.id = l.student_user_id
         WHERE l.book_id = ? AND l.returned_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [book.id]
      );
      const loan = loans[0];
      if (!loan) throw httpErr(409, 'לא נמצאה השאלה פעילה לספר זה');

      const [[{ overdueDays }]] = await conn.query(
        'SELECT GREATEST(DATEDIFF(CURDATE(), ?), 0) AS overdueDays', [loan.due_date]
      );

      await conn.query(
        `UPDATE loans
         SET returned_at = NOW(), return_condition = ?, return_notes = ?,
             overdue_days = ?, status = 'returned'
         WHERE id = ?`,
        [condition, notes, overdueDays, loan.id]
      );

      // Damaged book leaves circulation until librarian clears it
      const damaged = condition !== 'ok';
      await conn.query(
        'UPDATE books SET status = ? WHERE id = ?',
        [damaged ? 'damaged' : 'available', book.id]
      );

      // Debts (spec: overdue OR damage blocks future loans)
      const debtsCreated = [];
      if (overdueDays > 0) {
        await conn.query(
          `INSERT INTO debts (student_user_id, loan_id, reason, description)
           VALUES (?, ?, 'overdue', ?)`,
          [loan.student_user_id, loan.id, `איחור של ${overdueDays} ימים בהחזרת "${book.title}"`]
        );
        debtsCreated.push('overdue');
      }
      if (damaged) {
        await conn.query(
          `INSERT INTO debts (student_user_id, loan_id, reason, description)
           VALUES (?, ?, 'damage', ?)`,
          [loan.student_user_id, loan.id, `נזק לספר "${book.title}" (${condition})`]
        );
        debtsCreated.push('damage');
      }

      await queueNotification(conn, loan.student_user_id, 'return_confirm', {
        book: book.title, barcode: book.barcode,
        overdue_days: overdueDays, condition,
      });

      await conn.commit();
      res.json({
        message: 'ההחזרה נקלטה בהצלחה',
        student: loan.student_name,
        book: book.title,
        shelf_location: book.shelf_location,
        overdue_days: overdueDays,
        condition,
        debts_created: debtsCreated,
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

/**
 * GET /api/loans/active - librarian/management: all open loans.
 * Supports:
 *   ?filter=overdue   only loans past their due date
 *   ?filter=debt      only loans whose student currently has an open debt
 *   ?q=text           search by student name, book title, or exact barcode
 */
router.get(
  '/active',
  requireAuth,
  requireRole('librarian', 'management'),
  asyncH(async (req, res) => {
    const filter = (req.query.filter || 'all').trim();
    const term = (req.query.q || '').trim();

    const where = ['l.returned_at IS NULL'];
    const params = [];
    if (filter === 'overdue') where.push('l.due_date < CURDATE()');
    if (term) {
      where.push('(u.full_name LIKE ? OR b.title LIKE ? OR b.barcode = ?)');
      params.push(`%${term}%`, `%${term}%`, term);
    }

    const rows = await q(
      `SELECT l.id, b.barcode, b.title, u.id AS student_id, u.full_name AS student_name,
              s.student_number, s.class_name, l.loaned_at, l.due_date,
              GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS overdue_days,
              (SELECT COUNT(*) FROM debts d
                 WHERE d.student_user_id = u.id AND d.settled_at IS NULL) AS open_debts
       FROM loans l
       JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.student_user_id
       JOIN students s ON s.user_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY l.due_date ASC`,
      params
    );

    const result = filter === 'debt' ? rows.filter((r) => Number(r.open_debts) > 0) : rows;
    res.json(result);
  })
);

/** GET /api/loans/my - student: own loans (active + history) */
router.get(
  '/my',
  requireAuth,
  requireRole('student'),
  asyncH(async (req, res) => {
    const rows = await q(
      `SELECT l.id, b.barcode, b.title, b.author, l.loaned_at, l.due_date,
              l.returned_at, l.status,
              GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS overdue_days
       FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.student_user_id = ?
       ORDER BY l.loaned_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

/** Small helper to throw errors with HTTP status */
function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export default router;
