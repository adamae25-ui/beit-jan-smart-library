import { pool } from '../db.js';

/* ============================================================
   Notification engine (spec 1.7.1.8, 1.7.2.5, פרק 3):
   - Hebrew message templates
   - Provider routing PER CHANNEL: WhatsApp/SMS -> Twilio, Email -> SendGrid
     (NOTIFY_PROVIDER=console forces console logging for all channels,
     useful for local dev/testing without touching real accounts)
   - Worker: processes the pending queue every minute
   - Scheduler: queues due-date reminders + overdue alerts daily
   ============================================================ */

/* ---------- Message templates (Hebrew) ---------- */
const TEMPLATES = {
  loan_confirm: (p) =>
    `📚 ספריית בית ג'ן: הספר "${p.book}" הושאל לך בהצלחה. ` +
    `להחזרה עד ${fmtDate(p.due_date)}. ברקוד: ${p.barcode}`,
  return_confirm: (p) =>
    `✅ ספריית בית ג'ן: הספר "${p.book}" הוחזר בהצלחה.` +
    (p.overdue_days > 0 ? ` נרשם איחור של ${p.overdue_days} ימים.` : ' תודה!'),
  reservation_confirm: (p) =>
    `🔖 ספריית בית ג'ן: הספר "${p.book}" שוריין עבורך ל-${p.hours} שעות. ` +
    `יש לאסוף מהספרייה לפני פקיעת השריון.`,
  reservation_expired: (p) =>
    `⌛ ספריית בית ג'ן: השריון של "${p.book}" פג ובוטל אוטומטית. ` +
    `ניתן לשריין שוב אם הספר זמין.`,
  due_reminder: (p) =>
    `⏰ ספריית בית ג'ן: תזכורת - את/ה מחזיק/ה את "${p.book}" ` +
    `ויש להחזירו עד ${fmtDate(p.due_date)} (בעוד ${p.days_left} ימים).`,
  overdue_alert: (p) =>
    `⚠️ ספריית בית ג'ן: הספר "${p.book}" באיחור של ${p.overdue_days} ימים. ` +
    `נא להחזירו בהקדם כדי להימנע מחסימת השאלות.`,
  manual: (p) =>
    `📚 ספריית בית ג'ן: ${p.message}`,
};

function fmtDate(d) {
  return new Date(d).toLocaleDateString('he-IL');
}

/* ---------- Providers ---------- */
/**
 * Each provider: async send({ channel, to, message }) -> void (throws on failure).
 * Missing credentials throw a clear error, which the queue worker records
 * as a 'failed' notification (visible in the librarian's notification log)
 * rather than silently pretending the message went out.
 */
const providers = {
  console: {
    async send({ channel, to, message }) {
      console.log(`[notify:${channel}] -> ${to}: ${message}`);
    },
  },

  twilio: {
    async send({ channel, to, message }) {
      const sid = process.env.TWILIO_SID;
      const token = process.env.TWILIO_TOKEN;
      const from = process.env.TWILIO_FROM;
      if (!sid || !token || !from) throw new Error('Twilio credentials missing');
      const prefix = channel === 'whatsapp' ? 'whatsapp:' : '';
      const body = new URLSearchParams({
        To: `${prefix}${to}`,
        From: `${prefix}${from}`,
        Body: message,
      });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        }
      );
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    },
  },

  sendgrid: {
    async send({ to, message }) {
      const key = process.env.SENDGRID_KEY;
      const from = process.env.SENDGRID_FROM;
      if (!key || !from) throw new Error('SendGrid credentials missing');
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from, name: 'ספריית בית ג\'ן' },
          subject: 'עדכון מספריית בית הספר',
          content: [{ type: 'text/plain', value: message }],
        }),
      });
      if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
    },
  },
};

/**
 * Pick the provider for a given channel.
 * NOTIFY_PROVIDER=console forces console logging everywhere (dev/testing).
 * Otherwise: email -> SendGrid, whatsapp/sms -> Twilio. This lets both
 * real services run side by side, each handling the channel it's meant for.
 */
function getProviderForChannel(channel) {
  if (process.env.NOTIFY_PROVIDER === 'console') return providers.console;
  return channel === 'email' ? providers.sendgrid : providers.twilio;
}

/* ---------- Queue worker ---------- */
/**
 * Process up to `batch` pending notifications: render template,
 * resolve recipient (phone for sms/whatsapp, email for email),
 * send via the provider matching that notification's channel,
 * mark sent/failed.
 */
export async function processNotificationQueue(batch = 20) {
  const conn = await pool.getConnection();
  let processed = 0;
  try {
    const [rows] = await conn.query(
      `SELECT n.id, n.channel, n.template, n.payload,
              u.phone, u.email, u.full_name
       FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE n.status = 'pending'
       ORDER BY n.id ASC
       LIMIT ?`,
      [batch]
    );

    for (const n of rows) {
      try {
        const payload = typeof n.payload === 'string' ? JSON.parse(n.payload) : (n.payload || {});
        const render = TEMPLATES[n.template];
        if (!render) throw new Error(`unknown template: ${n.template}`);
        const to = n.channel === 'email' ? n.email : n.phone;
        if (!to) throw new Error(`recipient has no ${n.channel === 'email' ? 'email' : 'phone'}`);

        const provider = getProviderForChannel(n.channel);
        await provider.send({ channel: n.channel, to, message: render(payload) });
        await conn.query(
          "UPDATE notifications SET status='sent', sent_at=NOW() WHERE id = ?", [n.id]
        );
        processed++;
      } catch (e) {
        await conn.query(
          "UPDATE notifications SET status='failed', error_detail=? WHERE id = ?",
          [String(e.message).slice(0, 380), n.id]
        );
      }
    }
  } finally {
    conn.release();
  }
  return processed;
}

/* ---------- Reminder scheduler ---------- */
/**
 * Queues (idempotently, one per loan per template per day):
 *  - due_reminder: loans due in exactly `reminder_days_before` days
 *  - overdue_alert: loans past due date
 */
export async function queueDueReminders() {
  const conn = await pool.getConnection();
  let queued = 0;
  try {
    const [[{ days }]] = await conn.query(
      "SELECT CAST(setting_value AS UNSIGNED) AS days FROM settings WHERE setting_key='reminder_days_before'"
    );
    const [[{ channel }]] = await conn.query(
      "SELECT setting_value AS channel FROM settings WHERE setting_key='default_channel'"
    );

    // Due soon
    const [dueSoon] = await conn.query(
      `SELECT l.id, l.student_user_id, l.due_date, b.title,
              DATEDIFF(l.due_date, CURDATE()) AS days_left
       FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.returned_at IS NULL
         AND DATEDIFF(l.due_date, CURDATE()) = ?
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = l.student_user_id
             AND n.template = 'due_reminder'
             AND JSON_EXTRACT(n.payload, '$.loan_id') = l.id
             AND DATE(COALESCE(n.sent_at, NOW())) = CURDATE()
         )`,
      [days || 2]
    );
    for (const l of dueSoon) {
      await conn.query(
        `INSERT INTO notifications (user_id, channel, template, payload)
         VALUES (?, ?, 'due_reminder', ?)`,
        [l.student_user_id, channel, JSON.stringify({
          loan_id: l.id, book: l.title, due_date: l.due_date, days_left: l.days_left,
        })]
      );
      queued++;
    }

    // Overdue
    const [overdue] = await conn.query(
      `SELECT l.id, l.student_user_id, b.title,
              DATEDIFF(CURDATE(), l.due_date) AS overdue_days
       FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.returned_at IS NULL AND l.due_date < CURDATE()
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = l.student_user_id
             AND n.template = 'overdue_alert'
             AND JSON_EXTRACT(n.payload, '$.loan_id') = l.id
             AND DATE(COALESCE(n.sent_at, NOW())) = CURDATE()
         )`
    );
    for (const l of overdue) {
      await conn.query(
        `INSERT INTO notifications (user_id, channel, template, payload)
         VALUES (?, ?, 'overdue_alert', ?)`,
        [l.student_user_id, channel, JSON.stringify({
          loan_id: l.id, book: l.title, overdue_days: l.overdue_days,
        })]
      );
      await conn.query("UPDATE loans SET status='overdue' WHERE id = ?", [l.id]);
      queued++;
    }
  } finally {
    conn.release();
  }
  return queued;
}

/** Boot both background jobs (called from index.js) */
export function startNotificationWorkers({ queueMinutes = 1, reminderMinutes = 60 } = {}) {
  const safe = (fn, name) => () =>
    fn().catch((e) => console.error(`${name} failed:`, e.message));

  safe(queueDueReminders, 'reminder scheduler')();
  safe(processNotificationQueue, 'notification worker')();
  setInterval(safe(processNotificationQueue, 'notification worker'), queueMinutes * 60 * 1000);
  setInterval(safe(queueDueReminders, 'reminder scheduler'), reminderMinutes * 60 * 1000);
}
