import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/** Wrap async handlers so rejections reach Express's error handler */
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * POST /api/auth/login
 * body: { username, password, role }
 * The mockup login screen has a role selector; we verify the chosen
 * role matches the account's actual role (requirement 1.7.1.1).
 */
router.post('/login', asyncH(async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'יש להזין שם משתמש וסיסמה' });
  }

  const rows = await q(
    'SELECT id, username, password_hash, role, full_name, status FROM users WHERE username = ?',
    [username]
  );
  const user = rows[0];

  // Same generic error for wrong user / wrong password (no user enumeration)
  const badCreds = () =>
    res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });

  if (!user) return badCreds();
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return badCreds();

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'החשבון אינו פעיל - יש לפנות לספרנית' });
  }
  if (role && role !== user.role) {
    return res.status(403).json({ error: 'התפקיד שנבחר אינו תואם לחשבון זה' });
  }

  await q('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '8h' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, name: user.full_name },
  });
}));

/** GET /api/auth/me - current user from token */
router.get('/me', requireAuth, asyncH(async (req, res) => {
  const rows = await q(
    `SELECT u.id, u.username, u.role, u.full_name AS name, u.phone, u.email,
            s.student_number, s.class_name
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = ?`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json(rows[0]);
}));

/**
 * GET /api/auth/session-timeout
 * Idle-timeout policy in minutes, for the client's auto-logout timer.
 * Available to any authenticated role (not just librarian) since every
 * logged-in user needs to know how long they can stay idle.
 * Defaults to 15 if the setting was never configured.
 */
router.get('/session-timeout', requireAuth, asyncH(async (req, res) => {
  const rows = await q(
    "SELECT setting_value FROM settings WHERE setting_key = 'session_timeout_minutes'"
  );
  const minutes = rows[0] ? Number(rows[0].setting_value) : 15;
  res.json({ minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 15 });
}));

export default router;
