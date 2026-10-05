import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * GET /api/lookup/student?q=<number|name>
 * Librarian identifies a student before a loan (spec 1.7.1.2).
 * Returns profile + eligibility summary (debts, active loans, max).
 */
router.get(
  '/student',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const term = (req.query.q || '').trim();
    if (!term) return res.status(400).json({ error: 'יש להזין מספר תלמיד או שם' });

    const rows = await q(
      `SELECT u.id, u.full_name, u.phone, s.student_number, s.class_name, s.max_loans
       FROM users u
       JOIN students s ON s.user_id = u.id
       WHERE u.role = 'student' AND u.status = 'active'
         AND (s.student_number = ? OR s.national_id = ? OR u.full_name LIKE ?)
       LIMIT 5`,
      [term, term, `%${term}%`]
    );
    if (!rows.length) return res.status(404).json({ error: 'תלמיד לא נמצא במערכת' });

    // Enrich each candidate with eligibility data
    const result = [];
    for (const st of rows) {
      const [debts] = await Promise.all([
        q(`SELECT id, reason, description, created_at
           FROM debts WHERE student_user_id = ? AND settled_at IS NULL`, [st.id]),
      ]);
      const loans = await q(
        `SELECT l.id, b.title, b.barcode, l.due_date, l.status
         FROM loans l JOIN books b ON b.id = l.book_id
         WHERE l.student_user_id = ? AND l.returned_at IS NULL`,
        [st.id]
      );
      result.push({
        ...st,
        active_loans: loans,
        open_debts: debts,
        eligible: debts.length === 0 && loans.length < st.max_loans,
        block_reason:
          debts.length > 0
            ? 'לתלמיד חוב פתוח - יש להסדיר לפני השאלה חדשה'
            : loans.length >= st.max_loans
            ? `התלמיד הגיע למכסת ההשאלות (${st.max_loans})`
            : null,
      });
    }
    res.json(result);
  })
);

/**
 * GET /api/lookup/book?barcode=BK-0001
 * Librarian scans/types a barcode during loan or return.
 */
router.get(
  '/book',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const barcode = (req.query.barcode || '').trim();
    if (!barcode) return res.status(400).json({ error: 'יש להזין ברקוד' });

    const rows = await q('SELECT * FROM books WHERE barcode = ?', [barcode]);
    const book = rows[0];
    if (!book) return res.status(404).json({ error: 'ברקוד לא נמצא במערכת' });

    // If loaned - attach active loan info (needed for return screen)
    let activeLoan = null;
    if (book.status === 'loaned') {
      const loans = await q(
        `SELECT l.id, l.loaned_at, l.due_date, u.full_name AS student_name,
                s.student_number, s.class_name,
                GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS overdue_days
         FROM loans l
         JOIN users u ON u.id = l.student_user_id
         JOIN students s ON s.user_id = u.id
         WHERE l.book_id = ? AND l.returned_at IS NULL
         LIMIT 1`,
        [book.id]
      );
      activeLoan = loans[0] || null;
    }

    // If reserved - who holds the reservation (loan allowed only for them)
    let activeReservation = null;
    if (book.status === 'reserved') {
      const rs = await q(
        `SELECT r.id, r.expires_at, u.full_name AS student_name, r.student_user_id
         FROM reservations r JOIN users u ON u.id = r.student_user_id
         WHERE r.book_id = ? AND r.status = 'active'
         LIMIT 1`,
        [book.id]
      );
      activeReservation = rs[0] || null;
    }

    res.json({ ...book, active_loan: activeLoan, active_reservation: activeReservation });
  })
);

export default router;
