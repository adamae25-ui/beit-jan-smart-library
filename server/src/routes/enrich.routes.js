import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * GET /api/enrich/isbn/:isbn
 * Google Books API integration (spec פרק 3 - מערכות חיצוניות):
 * librarian types an ISBN in the "add book" form and gets
 * title/author/year auto-filled.
 *
 * Errors surface Google's own message and HTTP status verbatim, because a
 * generic "service unavailable" hides the difference between a bad API key,
 * an exhausted quota, a key restricted to the wrong referrer/IP, and the
 * book simply not being in Google's catalogue - which need different fixes.
 */
router.get(
  '/isbn/:isbn',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const isbn = String(req.params.isbn).replace(/[^0-9Xx]/g, '');
    if (isbn.length < 10) return res.status(400).json({ error: 'ISBN לא תקין' });

    const key = process.env.GOOGLE_BOOKS_API_KEY;
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key ? `&key=${key}` : ''}`;

    let raw;
    let httpStatus;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      httpStatus = r.status;
      raw = await r.text();
    } catch (e) {
      return res.status(502).json({
        error: 'לא ניתן להגיע לשירות Google Books (בעיית רשת או timeout) - ניתן להזין ידנית',
        detail: e.message,
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: `תשובה לא תקינה מ-Google Books (HTTP ${httpStatus}) - ניתן להזין ידנית`,
        detail: raw.slice(0, 300),
      });
    }

    if (httpStatus !== 200) {
      // Google returns { error: { code, message, errors:[{reason}] } }
      const gMsg = data?.error?.message || 'שגיאה לא ידועה';
      const gReason = data?.error?.errors?.[0]?.reason || '';
      return res.status(502).json({
        error: `Google Books החזיר שגיאה (HTTP ${httpStatus}): ${gMsg}${gReason ? ` [${gReason}]` : ''}`,
        detail: `reason=${gReason}; key_configured=${key ? 'yes' : 'no'}`,
      });
    }

    const item = data.items?.[0]?.volumeInfo;
    if (!item) {
      return res.status(404).json({
        error: `ISBN ${isbn} לא נמצא בקטלוג Google Books - ניתן להזין את הפרטים ידנית`,
      });
    }

    res.json({
      isbn,
      title: item.title || '',
      author: (item.authors || []).join(', '),
      publish_year: item.publishedDate ? Number(item.publishedDate.slice(0, 4)) : null,
      page_count: item.pageCount || null,
      language: item.language || null,
    });
  })
);

/**
 * GET /api/enrich/notifications?status=&page=
 * Librarian: notification log (queue monitoring per mockup settings screen).
 */
router.get(
  '/notifications',
  requireAuth,
  requireRole('librarian'),
  asyncH(async (req, res) => {
    const status = (req.query.status || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const PAGE = 30;

    const where = ['pending', 'sent', 'failed'].includes(status) ? 'WHERE n.status = ?' : '';
    const params = where ? [status] : [];

    const rows = await q(
      `SELECT n.id, n.channel, n.template, n.status, n.sent_at, n.error_detail,
              n.payload, u.full_name AS recipient
       FROM notifications n JOIN users u ON u.id = n.user_id
       ${where}
       ORDER BY n.id DESC
       LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      params
    );
    res.json(rows);
  })
);

export default router;
