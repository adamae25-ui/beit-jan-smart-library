import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TEMPLATE_HE = {
  loan_confirm: 'אישור השאלה',
  return_confirm: 'אישור החזרה',
  reservation_confirm: 'אישור שריון',
  reservation_expired: 'פקיעת שריון',
  due_reminder: 'תזכורת החזרה',
  overdue_alert: 'התראת איחור',
};
const STATUS_HE = { pending: 'ממתין', sent: 'נשלח', failed: 'נכשל' };
const CHANNEL_HE = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'אימייל' };

export default function Notifications() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  function load(s = status) {
    const params = s ? `?status=${s}` : '';
    api(`/enrich/notifications${params}`).then(setRows).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [status]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>יומן התראות</h1>
        <p className="page-sub">הודעות שנשלחו לתלמידים - אישורים, תזכורות והתראות איחור</p>
      </header>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="status-filter">
          <option value="">כל הסטטוסים</option>
          <option value="pending">ממתין</option>
          <option value="sent">נשלח</option>
          <option value="failed">נכשל</option>
        </select>
        <button className="btn-ghost" onClick={() => load()}>רענון</button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {rows && rows.length === 0 && <div className="empty-note">אין התראות להצגה.</div>}

      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>סוג</th><th>נמען</th><th>ערוץ</th><th>סטטוס</th><th>נשלח</th><th>שגיאה</th></tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td>{n.id}</td>
                  <td>{TEMPLATE_HE[n.template] || n.template}</td>
                  <td>{n.recipient}</td>
                  <td>{CHANNEL_HE[n.channel]}</td>
                  <td>
                    <span className={`status-badge s-${n.status === 'sent' ? 'available' : n.status === 'failed' ? 'damaged' : 'reserved'}`}>
                      {STATUS_HE[n.status]}
                    </span>
                  </td>
                  <td>{n.sent_at ? new Date(n.sent_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                  <td className="hint">{n.error_detail || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
