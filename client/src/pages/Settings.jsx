import { useEffect, useState } from 'react';
import { api } from '../api.js';

const LABELS = {
  max_loans_per_student: 'מקסימום ספרים לתלמיד',
  reservation_hours: 'תוקף שריון (שעות)',
  reminder_days_before: 'תזכורת - ימים לפני החזרה',
  session_timeout_minutes: 'זמן ניתוק אוטומטי (דקות)',
  loan_days_study: 'ימי השאלה - לימוד',
  loan_days_science: 'ימי השאלה - מדע',
  loan_days_literature: 'ימי השאלה - ספרות',
  loan_days_history: 'ימי השאלה - היסטוריה',
  loan_days_technology: 'ימי השאלה - טכנולוגיה',
  loan_days_other: 'ימי השאלה - אחר',
  default_channel: 'ערוץ התראות ברירת מחדל',
};

export default function Settings() {
  const [values, setValues] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/admin/settings')
      .then((rows) => {
        const obj = {};
        rows.forEach((r) => { obj[r.setting_key] = r.setting_value; });
        setValues(obj);
      })
      .catch((e) => setMsg({ type: 'err', text: e.message }));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api('/admin/settings', { method: 'PUT', body: values });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
    finally { setBusy(false); }
  }

  if (!values) return <div className="page"><p className="hint">טוען הגדרות…</p></div>;

  const numericKeys = Object.keys(LABELS).filter((k) => k !== 'default_channel');

  return (
    <div className="page">
      <header className="page-head">
        <h1>הגדרות מערכת</h1>
        <p className="page-sub">מדיניות השאלות, שריונים, התראות ואבטחת חשבון</p>
      </header>

      {msg && <div className={msg.type === 'ok' ? 'ok-note' : 'form-error'} role="alert">{msg.text}</div>}

      <form onSubmit={save} className="panel settings-form">
        <div className="form-grid">
          {numericKeys.map((k) => (
            <label key={k}>
              {LABELS[k]}
              <input
                type="number"
                min="1"
                max="365"
                value={values[k] ?? ''}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
            </label>
          ))}
          <label>
            {LABELS.default_channel}
            <select
              value={values.default_channel}
              onChange={(e) => setValues({ ...values, default_channel: e.target.value })}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">אימייל</option>
            </select>
          </label>
        </div>
        <button className="btn-primary" disabled={busy}>שמירת הגדרות</button>
      </form>
    </div>
  );
}
