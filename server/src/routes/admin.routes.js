import { Router } from 'express';
import bcrypt from 'bcrypt';
import { q, pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { processNotificationQueue } from '../services/notify.service.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Throw an error carrying an HTTP status for the handler to return */
function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ================= Settings (librarian) ================= */

/** GET /api/admin/settings - all system settings */
router.get(
  '/settings',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (_req, res) => {
    res.json(await q('SELECT setting_key, setting_value, description FROM settings ORDER BY setting_key'));
  })
);

/** PUT /api/admin/settings  { key: value, ... } - update settings */
router.put(
  '/settings',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const updates = req.body || {};
    const NUMERIC = [
      'max_loans_per_student', 'reservation_hours', 'reminder_days_before',
      'loan_days_study', 'loan_days_science', 'loan_days_literature',
      'loan_days_history', 'loan_days_technology', 'loan_days_other',
      'session_timeout_minutes',
    ];
    const CHANNELS = ['whatsapp', 'sms', 'email'];

    for (const [key, value] of Object.entries(updates)) {
      if (NUMERIC.includes(key)) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 365) {
          return res.status(400).json({ error: `ערך לא תקין עבור ${key} (1-365)` });
        }
      } else if (key === 'default_channel') {
        if (!CHANNELS.includes(value)) {
          return res.status(400).json({ error: 'ערוץ התראות לא תקין' });
        }
      } else {
        return res.status(400).json({ error: `הגדרה לא מוכרת: ${key}` });
      }
    }
    for (const [key, value] of Object.entries(updates)) {
      await q('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [String(value), key]);
    }
    res.json({ message: 'ההגדרות נשמרו' });
  })
);

/* ================= Students (librarian) ================= */

/** GET /api/admin/students - list with loan/debt counts */
router.get(
  '/students',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const term = (req.query.q || '').trim();
    const where = term
      ? `AND (u.full_name LIKE ? OR s.student_number LIKE ? OR s.class_name = ?)`
      : '';
    const params = term ? [`%${term}%`, `%${term}%`, term] : [];

    const rows = await q(
      `SELECT u.id, u.full_name, u.phone, u.email, u.status, s.student_number, s.class_name, s.max_loans,
         (SELECT COUNT(*) FROM loans l WHERE l.student_user_id = u.id AND l.returned_at IS NULL) AS active_loans,
         (SELECT COUNT(*) FROM debts d WHERE d.student_user_id = u.id AND d.settled_at IS NULL) AS open_debts
       FROM users u JOIN students s ON s.user_id = u.id
       WHERE u.role = 'student' AND u.status = 'active' ${where}
       ORDER BY u.full_name`,
      params
    );
    res.json(rows);
  })
);

/**
 * GET /api/admin/students/:id
 * Full profile for one student: contact info, currently active loans
 * (with book + due-date details), and open debts. Used by the "click a
 * student name" detail view (e.g. from the Live Monitor screen).
 * Available to librarian AND management (view-only, unlike the
 * edit/settle/notify actions below which stay librarian-only).
 */
router.get(
  '/students/:id',
  requireAuth,
  requireRole('librarian', 'management'),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const profile = await q(
      `SELECT u.id, u.full_name, u.phone, u.email, u.status,
              s.student_number, s.class_name, s.max_loans
       FROM users u JOIN students s ON s.user_id = u.id
       WHERE u.id = ? AND u.role = 'student'`,
      [id]
    );
    if (!profile[0]) return res.status(404).json({ error: 'תלמיד לא נמצא' });

    const activeLoans = await q(
      `SELECT l.id, b.title, b.author, b.barcode, b.shelf_location,
              l.loaned_at, l.due_date,
              GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS overdue_days
       FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.student_user_id = ? AND l.returned_at IS NULL
       ORDER BY l.due_date ASC`,
      [id]
    );
    const openDebts = await q(
      `SELECT id, reason, description, created_at
       FROM debts WHERE student_user_id = ? AND settled_at IS NULL`,
      [id]
    );

    res.json({ ...profile[0], active_loans: activeLoans, open_debts: openDebts });
  })
);

/** GET /api/admin/students/:id/debts - student's debts (open + settled) */
router.get(
  '/students/:id/debts',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const rows = await q(
      `SELECT d.id, d.reason, d.description, d.created_at, d.settled_at, d.settle_note,
              u2.full_name AS settled_by_name
       FROM debts d LEFT JOIN users u2 ON u2.id = d.settled_by
       WHERE d.student_user_id = ?
       ORDER BY d.created_at DESC`,
      [Number(req.params.id)]
    );
    res.json(rows);
  })
);

/**
 * POST /api/admin/debts/:id/settle  { note }
 * Settle a debt - note is REQUIRED (spec: הסדרה מחייבת הנמקה).
 */
router.post(
  '/debts/:id/settle',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const { note } = req.body || {};
    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'חובה לציין הנמקה להסדרת החוב' });
    }
    const id = Number(req.params.id);
    const rows = await q('SELECT * FROM debts WHERE id = ? AND settled_at IS NULL', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'חוב פתוח לא נמצא' });

    await q(
      'UPDATE debts SET settled_at = NOW(), settled_by = ?, settle_note = ? WHERE id = ?',
      [req.user.id, note.trim(), id]
    );
    res.json({ message: 'החוב הוסדר' });
  })
);

/**
 * PUT /api/admin/students/:id/contact   { phone, email }
 * Librarian updates a student's contact details directly from the UI.
 */
router.put(
  '/students/:id/contact',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const studentId = Number(req.params.id);
    const { phone, email } = req.body || {};

    if (phone === undefined && email === undefined) {
      return res.status(400).json({ error: 'יש לספק טלפון ו/או אימייל לעדכון' });
    }

    // Require full international format (+countrycode...) - WhatsApp/SMS
    // delivery silently goes to the wrong place without it, and Twilio
    // still returns success for the API call itself, which hides the bug.
    const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (phone !== undefined && phone !== '' && !PHONE_RE.test(phone.trim())) {
      return res.status(400).json({
        error: 'מספר טלפון לא תקין - יש להזין בפורמט בינלאומי מלא, למשל 972501234567+',
      });
    }
    if (email !== undefined && email !== '' && !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    }

    const student = await q(
      `SELECT id FROM users WHERE id = ? AND role = 'student'`,
      [studentId]
    );
    if (!student[0]) return res.status(404).json({ error: 'תלמיד לא נמצא' });

    const sets = [];
    const params = [];
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone.trim() || null); }
    if (email !== undefined) { sets.push('email = ?'); params.push(email.trim() || null); }
    params.push(studentId);

    await q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ message: 'פרטי הקשר עודכנו' });
  })
);

/**
 * POST /api/admin/students/:id/notify   { message, channel }
 * Librarian sends a free-text notification to a specific student, on demand.
 */
router.post(
  '/students/:id/notify',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const studentId = Number(req.params.id);
    const { message, channel } = req.body || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'יש להזין תוכן להודעה' });
    }
    if (message.trim().length > 300) {
      return res.status(400).json({ error: 'ההודעה ארוכה מדי (מקסימום 300 תווים)' });
    }

    const CHANNELS = ['whatsapp', 'sms', 'email'];
    let useChannel = channel;
    if (useChannel && !CHANNELS.includes(useChannel)) {
      return res.status(400).json({ error: 'ערוץ לא תקין' });
    }
    if (!useChannel) {
      const rows = await q(
        "SELECT setting_value FROM settings WHERE setting_key = 'default_channel'"
      );
      useChannel = rows[0]?.setting_value || 'whatsapp';
    }

    const student = await q(
      `SELECT u.id, u.full_name FROM users u
       JOIN students s ON s.user_id = u.id
       WHERE u.id = ? AND u.role = 'student'`,
      [studentId]
    );
    if (!student[0]) return res.status(404).json({ error: 'תלמיד לא נמצא' });

    const ins = await q(
      `INSERT INTO notifications (user_id, channel, template, payload)
       VALUES (?, ?, 'manual', ?)`,
      [studentId, useChannel, JSON.stringify({ message: message.trim() })]
    );

    await processNotificationQueue(5);

    const sent = await q(
      'SELECT status, error_detail FROM notifications WHERE id = ?',
      [ins.insertId]
    );
    const result = sent[0] || { status: 'pending' };

    if (result.status === 'sent') {
      res.json({ message: `ההודעה נשלחה ל${student[0].full_name}`, status: 'sent' });
    } else if (result.status === 'failed') {
      res.status(502).json({
        error: `שליחת ההודעה נכשלה: ${result.error_detail || 'שגיאה לא ידועה'}`,
        status: 'failed',
      });
    } else {
      res.json({ message: 'ההודעה בתור לשליחה', status: 'pending' });
    }
  })
);

/**
 * POST /api/admin/students   { full_name, student_number, national_id,
 *                              class_name, username, password, phone, email, max_loans }
 * Creates a new student: a users row (role='student') plus its students row,
 * in one transaction so a failure can't leave a half-created account.
 */
router.post(
  '/students',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const {
      full_name, student_number, national_id, class_name,
      username, password, phone, email, max_loans,
    } = req.body || {};

    if (!full_name?.trim() || !student_number?.trim() || !class_name?.trim() || !username?.trim()) {
      return res.status(400).json({ error: 'שם, מספר תלמיד, כיתה ושם משתמש הם שדות חובה' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    }

    const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (phone && !PHONE_RE.test(phone.trim())) {
      return res.status(400).json({
        error: 'מספר טלפון לא תקין - יש להזין בפורמט בינלאומי מלא, למשל 972501234567+',
      });
    }
    if (email && !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    }

    const quota = Number(max_loans);
    const maxLoans = Number.isInteger(quota) && quota > 0 && quota <= 20 ? quota : 3;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [dupUser] = await conn.query('SELECT id FROM users WHERE username = ?', [username.trim()]);
      if (dupUser.length) throw httpErr(409, 'שם המשתמש כבר קיים במערכת');

      const [dupNum] = await conn.query(
        'SELECT user_id FROM students WHERE student_number = ? OR national_id = ?',
        [student_number.trim(), (national_id || student_number).trim()]
      );
      if (dupNum.length) throw httpErr(409, 'מספר תלמיד או ת.ז כבר קיימים במערכת');

      const hash = await bcrypt.hash(password, 10);
      const [ins] = await conn.query(
        `INSERT INTO users (username, password_hash, role, full_name, phone, email, status)
         VALUES (?, ?, 'student', ?, ?, ?, 'active')`,
        [username.trim(), hash, full_name.trim(), phone?.trim() || null, email?.trim() || null]
      );
      await conn.query(
        `INSERT INTO students (user_id, student_number, national_id, class_name, max_loans)
         VALUES (?, ?, ?, ?, ?)`,
        [ins.insertId, student_number.trim(), (national_id || student_number).trim(),
         class_name.trim(), maxLoans]
      );

      await conn.commit();
      res.status(201).json({ id: ins.insertId, message: `התלמיד ${full_name.trim()} נוסף בהצלחה` });
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
 * DELETE /api/admin/students/:id
 * Removes a student. Loans/debts reference the user row, so a hard delete
 * would break that history; instead the account is deactivated (it stops
 * appearing as active and can no longer log in) and only permitted once
 * the student has nothing outstanding.
 */
router.delete(
  '/students/:id',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const id = Number(req.params.id);

    const student = await q(
      `SELECT u.id, u.full_name FROM users u
       JOIN students s ON s.user_id = u.id
       WHERE u.id = ? AND u.role = 'student'`,
      [id]
    );
    if (!student[0]) return res.status(404).json({ error: 'תלמיד לא נמצא' });

    const [{ activeLoans }] = await q(
      'SELECT COUNT(*) AS activeLoans FROM loans WHERE student_user_id = ? AND returned_at IS NULL',
      [id]
    );
    if (activeLoans > 0) {
      return res.status(409).json({
        error: `לא ניתן להסיר - לתלמיד ${activeLoans} ספרים שטרם הוחזרו`,
      });
    }

    const [{ openDebts }] = await q(
      'SELECT COUNT(*) AS openDebts FROM debts WHERE student_user_id = ? AND settled_at IS NULL',
      [id]
    );
    if (openDebts > 0) {
      return res.status(409).json({
        error: `לא ניתן להסיר - לתלמיד ${openDebts} חובות פתוחים שיש להסדיר תחילה`,
      });
    }

    await q("UPDATE reservations SET status = 'cancelled' WHERE student_user_id = ? AND status = 'active'", [id]);
    await q("UPDATE users SET status = 'inactive' WHERE id = ?", [id]);

    res.json({ message: `${student[0].full_name} הוסר מרשימת התלמידים הפעילים` });
  })
);

export default router;
