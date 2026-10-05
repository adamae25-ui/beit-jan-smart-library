import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const GENRES = ['study', 'science', 'literature', 'history', 'technology', 'other'];
const GENRE_HE = {
  study: 'לימוד', science: 'מדע', literature: 'ספרות',
  history: 'היסטוריה', technology: 'טכנולוגיה', other: 'אחר',
};
const REASON_HE = { overdue: 'איחור', damage: 'נזק', lost: 'אבדן' };
const STATUS_HE = { active: 'פעיל', returned: 'הוחזר', overdue: 'באיחור' };
const TYPE_HE = { all: 'כל-ההשאלות', active: 'השאלות-פעילות', overdue: 'איחורים', debts: 'חובות-וחוסרים' };

/** Extra WHERE fragment for the loans-based report types */
function loanTypeCondition(type) {
  if (type === 'active') return 'l.returned_at IS NULL';
  if (type === 'overdue') {
    return '((l.returned_at IS NULL AND l.due_date < CURDATE()) OR (l.returned_at IS NOT NULL AND l.overdue_days > 0))';
  }
  return null;
}

/** Build a WHERE clause + params for date-range/genre/type filters on loans */
function buildLoanFilter(query) {
  const { from, to, genre, type } = query;
  const where = [];
  const params = [];

  if (from) { where.push('l.loaned_at >= ?'); params.push(from); }
  if (to) { where.push('l.loaned_at <= ?'); params.push(`${to} 23:59:59`); }
  if (!from && !to) { where.push('l.loaned_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)'); }

  let genreFilter = null;
  if (genre && GENRES.includes(genre)) {
    genreFilter = genre;
    where.push('b.genre = ?');
    params.push(genre);
  }

  const typeCond = loanTypeCondition(type);
  if (typeCond) where.push(typeCond);

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, genreFilter };
}

/** Build a WHERE clause + params for date-range/genre filters on debts */
function buildDebtFilter(query) {
  const { from, to, genre } = query;
  const where = [];
  const params = [];

  if (from) { where.push('d.created_at >= ?'); params.push(from); }
  if (to) { where.push('d.created_at <= ?'); params.push(`${to} 23:59:59`); }
  if (!from && !to) { where.push('d.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)'); }

  let genreFilter = null;
  if (genre && GENRES.includes(genre)) {
    genreFilter = genre;
    where.push('b.genre = ?');
    params.push(genre);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, genreFilter };
}

async function fetchDebts(query) {
  const { whereSql, params } = buildDebtFilter(query);
  return q(
    `SELECT d.id, d.created_at, d.reason, d.description, d.settled_at, d.settle_note,
            b.title, b.barcode, b.genre,
            u.full_name AS student_name, s.class_name, s.student_number
     FROM debts d
     LEFT JOIN loans l ON l.id = d.loan_id
     LEFT JOIN books b ON b.id = l.book_id
     JOIN users u ON u.id = d.student_user_id
     JOIN students s ON s.user_id = u.id
     ${whereSql}
     ORDER BY d.created_at DESC`,
    params
  );
}

/**
 * GET /api/reports/summary?from=&to=&genre=&type=
 * type: all (default) | active | overdue | debts
 * Loan-based types return chart-friendly aggregates; debts returns a
 * filtered detail list instead (a list suits "who owes what" better than bars).
 * The three top stat cards (total loans / overdue rate / open debts) are
 * always current-state snapshots, independent of the filters.
 */
router.get(
  '/summary',
  requireAuth,
  requireRole('librarian', 'management'),
  asyncH(async (req, res) => {
    const type = ['all', 'active', 'overdue', 'debts'].includes(req.query.type)
      ? req.query.type : 'all';

    const [overdue] = await q(
      `SELECT
         COUNT(*) AS total_loans,
         SUM(overdue_days > 0 OR (returned_at IS NULL AND due_date < CURDATE())) AS overdue_loans
       FROM loans`
    );
    const [debtStats] = await q(
      `SELECT COUNT(*) AS open_debts,
         SUM(reason='overdue') AS overdue_debts,
         SUM(reason='damage') AS damage_debts
       FROM debts WHERE settled_at IS NULL`
    );

    if (type === 'debts') {
      const debts = await fetchDebts(req.query);
      return res.json({ type, overdue_stats: overdue, debt_stats: debtStats, debts });
    }

    const { whereSql, params } = buildLoanFilter(req.query);
    const [perMonth, topBooks, byGenre, byClass] = await Promise.all([
      q(
        `SELECT DATE_FORMAT(l.loaned_at, '%Y-%m') AS month, COUNT(*) AS loans
         FROM loans l JOIN books b ON b.id = l.book_id
         ${whereSql}
         GROUP BY month ORDER BY month`,
        params
      ),
      q(
        `SELECT b.title, b.author, COUNT(*) AS times
         FROM loans l JOIN books b ON b.id = l.book_id
         ${whereSql}
         GROUP BY l.book_id ORDER BY times DESC LIMIT 5`,
        params
      ),
      q(
        `SELECT b.genre, COUNT(*) AS loans
         FROM loans l JOIN books b ON b.id = l.book_id
         ${whereSql}
         GROUP BY b.genre ORDER BY loans DESC`,
        params
      ),
      q(
        `SELECT s.class_name, COUNT(l.id) AS loans
         FROM loans l
         JOIN books b ON b.id = l.book_id
         JOIN students s ON s.user_id = l.student_user_id
         ${whereSql}
         GROUP BY s.class_name ORDER BY loans DESC`,
        params
      ),
    ]);

    res.json({
      type,
      loans_per_month: perMonth,
      top_books: topBooks,
      by_genre: byGenre,
      by_class: byClass,
      overdue_stats: overdue,
      debt_stats: debtStats,
    });
  })
);

/**
 * GET /api/reports/export?from=&to=&genre=&type=
 * Downloadable CSV (UTF-8 with BOM so Excel opens Hebrew correctly).
 * type=debts exports the debts list; other types export the loans list
 * (optionally restricted to active-only or overdue-only).
 */
router.get(
  '/export',
  requireAuth,
  requireRole('librarian', 'management'),
  asyncH(async (req, res) => {
    const type = ['all', 'active', 'overdue', 'debts'].includes(req.query.type)
      ? req.query.type : 'all';

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '');

    let headers, lines, genreFilter;

    if (type === 'debts') {
      const rows = await fetchDebts(req.query);
      genreFilter = buildDebtFilter(req.query).genreFilter;
      headers = ['תאריך', 'סיבה', 'תיאור', 'שם הספר', 'ברקוד', "ז'אנר",
        'שם התלמיד', 'כיתה', "מס' תלמיד", 'הוסדר בתאריך', 'הערת הסדרה'];
      lines = [headers.map(esc).join(',')];
      for (const r of rows) {
        lines.push([
          fmtDate(r.created_at), REASON_HE[r.reason] || r.reason, r.description || '',
          r.title || '', r.barcode || '', r.genre ? (GENRE_HE[r.genre] || r.genre) : '',
          r.student_name, r.class_name, r.student_number,
          fmtDate(r.settled_at), r.settle_note || '',
        ].map(esc).join(','));
      }
    } else {
      const { whereSql, params, genreFilter: gf } = buildLoanFilter({ ...req.query, type });
      genreFilter = gf;
      const rows = await q(
        `SELECT l.loaned_at, l.due_date, l.returned_at, l.status,
                GREATEST(DATEDIFF(COALESCE(l.returned_at, CURDATE()), l.due_date), 0) AS overdue_days,
                b.title, b.author, b.genre, b.barcode,
                u.full_name AS student_name, s.class_name, s.student_number
         FROM loans l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.student_user_id
         JOIN students s ON s.user_id = u.id
         ${whereSql}
         ORDER BY l.loaned_at DESC`,
        params
      );
      headers = [
        'תאריך השאלה', 'תאריך יעד', 'תאריך החזרה', 'סטטוס', 'ימי איחור',
        'שם הספר', 'מחבר', "ז'אנר", 'ברקוד', 'שם התלמיד', 'כיתה', "מס' תלמיד",
      ];
      lines = [headers.map(esc).join(',')];
      for (const r of rows) {
        lines.push([
          fmtDate(r.loaned_at), fmtDate(r.due_date), fmtDate(r.returned_at),
          STATUS_HE[r.status] || r.status, r.overdue_days,
          r.title, r.author || '', GENRE_HE[r.genre] || r.genre, r.barcode,
          r.student_name, r.class_name, r.student_number,
        ].map(esc).join(','));
      }
    }

    const csv = '\uFEFF' + lines.join('\r\n');

    const filenameParts = ['דוח', TYPE_HE[type]];
    if (req.query.from) filenameParts.push(req.query.from);
    if (req.query.to) filenameParts.push(req.query.to);
    if (genreFilter) filenameParts.push(GENRE_HE[genreFilter]);
    const filename = `${filenameParts.join('_')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(csv);
  })
);

export default router;
