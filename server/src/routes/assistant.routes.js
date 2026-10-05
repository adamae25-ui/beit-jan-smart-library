import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/* ============================================================
   Smart Library AI Assistant
   - Claude API (Messages + Tool Use) via fetch, no SDK needed
   - Role-aware: the agent gets tools matching the user's role
   - Agentic loop: Claude decides when to query the database
   Docs: https://docs.claude.com/en/api/overview
   ============================================================ */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
const MAX_TURNS = 5;          // tool-use loop safety cap
const MAX_HISTORY = 20;       // messages kept from client history
const MAX_TOKENS = 1536;      // headroom so Hebrew replies don't cut off mid-word

/* ---------- Tools the agent can use (role-gated) ---------- */

const GENRE_HE = {
  study: 'לימוד', science: 'מדע', literature: 'ספרות',
  history: 'היסטוריה', technology: 'טכנולוגיה', other: 'אחר',
};

const TOOL_DEFS = {
  search_books: {
    roles: ['student', 'librarian', 'management'],
    def: {
      name: 'search_books',
      description:
        'חיפוש ספרים בקטלוג הספרייה לפי טקסט חופשי (שם/מחבר/ברקוד) ו/או ז\'אנר. ' +
        'מחזיר עד 10 תוצאות עם סטטוס זמינות.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'טקסט חיפוש (אופציונלי)' },
          genre: {
            type: 'string',
            enum: ['study', 'science', 'literature', 'history', 'technology', 'other'],
            description: 'סינון ז\'אנר (אופציונלי)',
          },
        },
      },
    },
    async run(input, user) {
      const where = user.role === 'student' ? ["status != 'removed'"] : ['1=1'];
      const params = [];
      if (input.query) {
        where.push('(title LIKE ? OR author LIKE ? OR barcode = ?)');
        params.push(`%${input.query}%`, `%${input.query}%`, input.query);
      }
      if (input.genre) { where.push('genre = ?'); params.push(input.genre); }
      return q(
        `SELECT barcode, title, author, genre, shelf_location, status
         FROM books WHERE ${where.join(' AND ')} ORDER BY title LIMIT 10`,
        params
      );
    },
  },

  get_my_loans: {
    roles: ['student'],
    def: {
      name: 'get_my_loans',
      description: 'שליפת ההשאלות של התלמיד המחובר - פעילות והיסטוריה, כולל ימי איחור.',
      input_schema: { type: 'object', properties: {} },
    },
    async run(_input, user) {
      return q(
        `SELECT b.title, b.barcode, l.due_date, l.returned_at, l.status,
                GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS overdue_days
         FROM loans l JOIN books b ON b.id = l.book_id
         WHERE l.student_user_id = ? ORDER BY l.loaned_at DESC LIMIT 15`,
        [user.id]
      );
    },
  },

  get_my_reservations: {
    roles: ['student'],
    def: {
      name: 'get_my_reservations',
      description: 'שליפת השריונים של התלמיד המחובר, כולל דקות שנותרו עד פקיעה.',
      input_schema: { type: 'object', properties: {} },
    },
    async run(_input, user) {
      return q(
        `SELECT b.title, b.shelf_location, r.status, r.expires_at,
                GREATEST(TIMESTAMPDIFF(MINUTE, NOW(), r.expires_at), 0) AS minutes_left
         FROM reservations r JOIN books b ON b.id = r.book_id
         WHERE r.student_user_id = ? ORDER BY r.reserved_at DESC LIMIT 10`,
        [user.id]
      );
    },
  },

  get_my_debts: {
    roles: ['student'],
    def: {
      name: 'get_my_debts',
      description: 'בדיקה האם לתלמיד המחובר יש חובות פתוחים החוסמים השאלות.',
      input_schema: { type: 'object', properties: {} },
    },
    async run(_input, user) {
      return q(
        `SELECT reason, description, created_at
         FROM debts WHERE student_user_id = ? AND settled_at IS NULL`,
        [user.id]
      );
    },
  },

  recommend_books: {
    roles: ['student'],
    def: {
      name: 'recommend_books',
      description:
        'המלצה על ספרים לתלמיד המחובר, לפי ז\'אנרים/מחברים שקרא בעבר (היסטוריית קריאה) ' +
        'או לפי העדפה/צורך שציין (נושא, ז\'אנר, רמת קושי). מחזיר רק ספרים זמינים שהתלמיד ' +
        'עדיין לא השאיל.',
      input_schema: {
        type: 'object',
        properties: {
          genre: {
            type: 'string',
            enum: ['study', 'science', 'literature', 'history', 'technology', 'other'],
            description: 'ז\'אנר מבוקש, אם המשתמש ציין העדפה מפורשת',
          },
        },
      },
    },
    async run(input, user) {
      let genre = input.genre;
      if (!genre) {
        const rows = await q(
          `SELECT b.genre FROM loans l JOIN books b ON b.id = l.book_id
           WHERE l.student_user_id = ? GROUP BY b.genre ORDER BY COUNT(*) DESC LIMIT 1`,
          [user.id]
        );
        genre = rows[0]?.genre || null;
      }
      const params = genre ? [genre, user.id] : [user.id];
      return q(
        `SELECT barcode, title, author, genre, shelf_location FROM books
         WHERE status = 'available' ${genre ? 'AND genre = ?' : ''}
         AND id NOT IN (SELECT book_id FROM loans WHERE student_user_id = ?)
         ORDER BY title LIMIT 8`,
        params
      );
    },
  },

  get_library_stats: {
    roles: ['librarian', 'management'],
    def: {
      name: 'get_library_stats',
      description: 'נתוני פעילות הספרייה: השאלות פעילות, איחורים, שריונים, חובות ומלאי.',
      input_schema: { type: 'object', properties: {} },
    },
    async run() {
      const [loans] = await q(
        `SELECT SUM(returned_at IS NULL) AS active_loans,
                SUM(returned_at IS NULL AND due_date < CURDATE()) AS overdue
         FROM loans`
      );
      const [books] = await q(
        `SELECT COUNT(*) AS total, SUM(status='available') AS available,
                SUM(status='damaged') AS damaged
         FROM books WHERE status != 'removed'`
      );
      const [debts] = await q(
        `SELECT COUNT(*) AS open_debts FROM debts WHERE settled_at IS NULL`
      );
      return { ...loans, ...books, ...debts };
    },
  },

  get_active_loans: {
    roles: ['librarian', 'management'],
    def: {
      name: 'get_active_loans',
      description:
        'שליפת רשימת ההשאלות הפעילות בספרייה כרגע (מי מחזיק אילו ספרים), עם אפשרות ' +
        'לסנן רק השאלות שבאיחור. שימושי לשאלות כמו "מי מאחר בהחזרה" או "אילו ספרים ' +
        'אצל תלמידים כרגע". מקביל למסך "מעקב חי" בממשק.',
      input_schema: {
        type: 'object',
        properties: {
          only_overdue: {
            type: 'boolean',
            description: 'אם true, מחזיר רק השאלות שכרגע באיחור',
          },
        },
      },
    },
    async run(input) {
      const where = ['l.returned_at IS NULL'];
      if (input.only_overdue) where.push('l.due_date < CURDATE()');
      return q(
        `SELECT b.title, b.barcode, u.full_name AS student_name, s.class_name, l.due_date,
                GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS overdue_days
         FROM loans l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.student_user_id
         JOIN students s ON s.user_id = u.id
         WHERE ${where.join(' AND ')}
         ORDER BY l.due_date ASC LIMIT 20`
      );
    },
  },

  get_active_reservations: {
    roles: ['librarian', 'management'],
    def: {
      name: 'get_active_reservations',
      description:
        'שליפת רשימת השריונים הפעילים כרגע בספרייה - מי משריין איזה ספר וכמה זמן נותר ' +
        'עד פקיעה אוטומטית. מקביל למסך "מעקב חי" בממשק.',
      input_schema: { type: 'object', properties: {} },
    },
    async run() {
      return q(
        `SELECT b.title, b.barcode, u.full_name AS student_name, s.class_name,
                GREATEST(TIMESTAMPDIFF(MINUTE, NOW(), r.expires_at), 0) AS minutes_left
         FROM reservations r
         JOIN books b ON b.id = r.book_id
         JOIN users u ON u.id = r.student_user_id
         JOIN students s ON s.user_id = u.id
         WHERE r.status = 'active'
         ORDER BY r.expires_at ASC LIMIT 20`
      );
    },
  },

  get_system_settings: {
    roles: ['librarian'],
    def: {
      name: 'get_system_settings',
      description: 'שליפת הגדרות המערכת: מכסות, ימי השאלה לפי ז\'אנר, תוקף שריון, זמן ניתוק אוטומטי וכו\'.',
      input_schema: { type: 'object', properties: {} },
    },
    async run() {
      return q('SELECT setting_key, setting_value, description FROM settings');
    },
  },
};

/* ---------- System prompt per role ---------- */

function buildSystemPrompt(user) {
  const roleDesc = {
    student:
      'המשתמש הוא תלמיד/ה. עזור לו/ה למצוא ספרים, להבין את מצב ההשאלות והשריונים, ' +
      'להמליץ על ספרים מתאימים, ולהכיר את נהלי הספרייה. אינך יכול לבצע השאלות או שריונים ' +
      'בשמו - הפנה למסכים המתאימים (חיפוש ספרים / השריונים שלי / היסטוריה).',
    librarian:
      'המשתמשת היא הספרנית. עזרי לה עם נתוני הספרייה, מעקב אחר השאלות ושריונים בזמן אמת, ' +
      'איתור ספרים ותפעול המערכת. לביצוע פעולות (השאלה/החזרה/הסדרת חוב/עדכון פרטי קשר/' +
      'שליחת הודעה ידנית) הפני למסכים המתאימים.',
    management:
      'המשתמש הוא חבר הנהלה. עזור לו להבין את נתוני הפעילות של הספרייה, כולל מצב ' +
      'ההשאלות והשריונים בזמן אמת ודוחות.',
  }[user.role];

  return (
    `אתה "העוזר החכם" של מערכת Beit Jan Smart Library - מערכת ניהול ספריית תיכון בית ג'ן.\n` +
    `שם המשתמש המחובר: ${user.name}. ${roleDesc}\n\n` +
    `מסכי המערכת: לוח בקרה, מעקב חי (השאלות ושריונים פעילים בזמן אמת, כולל לחיצה על שם ` +
    `תלמיד לצפייה בפרטיו המלאים - ספרנית/הנהלה), השאלת ספר (ספרנית), החזרת ספר (ספרנית), ` +
    `ניהול מלאי (ספרנית), תלמידים (ספרנית - כולל עריכת פרטי קשר ושליחת הודעות ידניות), ` +
    `חיפוש ספרים, השריונים שלי (תלמיד), היסטוריה (תלמיד), דוחות (עם סינון לפי תאריך/` +
    `קטגוריה/סוג-דוח והפקת קובץ CSV להורדה), הגדרות, יומן התראות. בסרגל הצד יש גם כפתור ` +
    `להחלפת תצוגה בין מצב בהיר למצב כהה.\n` +
    `נהלים עיקריים: שריון תקף 48 שעות ואז מתבטל אוטומטית; חוב פתוח (איחור/נזק) חוסם השאלות ` +
    `חדשות עד הסדרה אצל הספרנית; תאריך ההחזרה נקבע לפי ז'אנר הספר; התראות נשלחות ב-` +
    `WhatsApp/SMS/אימייל (כולל אפשרות לשליחת הודעה ידנית חופשית מהספרנית); המשתמש מנותק ` +
    `אוטומטית לאחר חוסר פעילות ממושך (זמן ניתן להגדרה במסך ההגדרות).\n\n` +
    `ענה תמיד בעברית תקינה ומדויקת, ללא שגיאות כתיב, במשפטים קצרים וברורים. ` +
    `כשאתה מזכיר שם של מסך במערכת או מדגיש מספר/נתון חשוב, עטוף אותו בכוכביות כפולות ` +
    `(לדוגמה: **מעקב חי**) - הממשק ממיר זאת אוטומטית להדגשה או לקישור לחיץ למסך. ` +
    `שמות ספרים כתוב במירכאות בלבד, ללא כוכביות (לדוגמה: "1984"). ` +
    `לעולם אל תשתמש בכוכבית בודדת (*) - לא להדגשה ולא לרשימות; לרשימות השתמש במקף (-). ` +
    `אל תשתמש בסימני עיצוב אחרים (כמו # או טבלאות) כי הם יוצגו כטקסט גולמי. ` +
    `השתמש בכלים כשצריך נתונים אמיתיים - אל תמציא נתונים. סייע גם בניווט במערכת (הכוונה למסך ` +
    `המתאים) ובמענה לשאלות כלליות על המערכת והספרייה. אם שאלה אינה קשורה לספרייה, הסבר ` +
    `בנימוס שאתה עוזר הספרייה בלבד.`
  );
}

/* ---------- The agentic loop ---------- */

async function callClaude(apiKey, body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * POST /api/assistant/chat   { messages: [{role:'user'|'assistant', content:string}] }
 * Runs the agent loop: Claude may call tools (executed here against MySQL
 * with the caller's permissions), then returns the final Hebrew answer.
 */
router.post(
  '/chat',
  requireAuth,
  asyncH(async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error:
          'העוזר החכם אינו מוגדר עדיין - יש להוסיף ANTHROPIC_API_KEY לקובץ .env של השרת. ' +
          'מפתח ניתן להנפיק ב-console.anthropic.com',
      });
    }

    const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const clean = history
      .filter((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
    if (!clean.length || clean[clean.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'נדרשת הודעת משתמש' });
    }

    const available = Object.values(TOOL_DEFS).filter((t) => t.roles.includes(req.user.role));
    const tools = available.map((t) => t.def);
    const byName = Object.fromEntries(available.map((t) => [t.def.name, t]));

    const messages = [...clean];
    const toolsUsed = [];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const data = await callClaude(apiKey, {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(req.user),
        tools,
        messages,
      });

      if (data.stop_reason !== 'tool_use') {
        const text = data.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return res.json({ reply: text, tools_used: toolsUsed });
      }

      messages.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;
        const tool = byName[block.name];
        let result;
        try {
          result = tool
            ? await tool.run(block.input || {}, req.user)
            : { error: 'unknown tool' };
        } catch (e) {
          result = { error: e.message };
        }
        toolsUsed.push(block.name);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: results });
    }

    res.json({
      reply: 'מצטער, לא הצלחתי להשלים את הבקשה - נסו לנסח אותה מחדש.',
      tools_used: toolsUsed,
    });
  })
);

export default router;
