import { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_HE = {
  active: 'פעיל', fulfilled: 'מומש', expired: 'פג תוקף', cancelled: 'בוטל',
};

function timeLeft(minutes) {
  if (minutes <= 0) return 'פג';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} שעות ו-${m} דק'` : `${m} דק'`;
}

export default function Reservations() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = () => api('/reservations/my').then(setRows).catch((e) => setMsg({ type: 'err', text: e.message }));
  useEffect(() => { load(); }, []);

  async function cancel(id) {
    setMsg(null);
    try {
      const r = await api(`/reservations/${id}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
      load();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>השריונים שלי</h1>
        <p className="page-sub">שריון תקף ל-48 שעות - יש לאסוף את הספר מהספרייה בזמן</p>
      </header>

      {msg && (
        <div className={msg.type === 'ok' ? 'ok-note' : 'form-error'} role="alert">{msg.text}</div>
      )}

      {rows && rows.length === 0 && (
        <div className="empty-note">אין שריונים. אפשר לשריין ספרים זמינים ממסך החיפוש.</div>
      )}

      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ספר</th><th>מדף</th><th>שוריין ב-</th><th>נותר</th><th>סטטוס</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong><div className="hint">{r.barcode}</div></td>
                  <td>{r.shelf_location}</td>
                  <td>{new Date(r.reserved_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{r.status === 'active' ? timeLeft(r.minutes_left) : '—'}</td>
                  <td><span className={`status-badge s-${r.status === 'active' ? 'reserved' : r.status === 'fulfilled' ? 'available' : 'damaged'}`}>{STATUS_HE[r.status]}</span></td>
                  <td>
                    {r.status === 'active' && (
                      <button className="btn-ghost sm" onClick={() => cancel(r.id)}>ביטול</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
