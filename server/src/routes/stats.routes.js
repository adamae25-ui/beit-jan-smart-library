import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** GET /api/stats/dashboard - counts tailored to the caller's role */
router.get(
  '/dashboard',
  requireAuth,
  asyncH(async (req, res) => {
    if (req.user.role === 'student') {
      const [mine] = await q(
        `SELECT
           SUM(returned_at IS NULL) AS active_loans,
           SUM(returned_at IS NULL AND due_date < CURDATE()) AS overdue,
           SUM(returned_at IS NULL AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS due_this_week
         FROM loans WHERE student_user_id = ?`,
        [req.user.id]
      );
      const [res2] = await q(
        `SELECT COUNT(*) AS active_reservations
         FROM reservations WHERE student_user_id = ? AND status = 'active'`,
        [req.user.id]
      );
      return res.json({ ...mine, ...res2 });
    }

    // librarian + management: library-wide numbers
    const [loans] = await q(
      `SELECT
         SUM(returned_at IS NULL) AS active_loans,
         SUM(returned_at IS NULL AND due_date < CURDATE()) AS overdue
       FROM loans`
    );
    const [resv] = await q(
      `SELECT COUNT(*) AS active_reservations FROM reservations WHERE status = 'active'`
    );
    const [books] = await q(
      `SELECT COUNT(*) AS total_books,
              SUM(status = 'available') AS available_books
       FROM books WHERE status != 'removed'`
    );
    res.json({ ...loans, ...resv, ...books });
  })
);

export default router;
