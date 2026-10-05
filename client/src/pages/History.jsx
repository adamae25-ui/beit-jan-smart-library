import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function History() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/loans/my').then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h1>ההשאלות שלי</h1>
        <p className="page-sub">ספרים אצלך כרגע והיסטוריית השאלות</p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {rows && rows.length === 0 && <div className="empty-note">עדיין לא השאלת ספרים.</div>}

      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>ספר</th><th>הושאל</th><th>להחזרה</th><th>הוחזר</th><th>סטטוס</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const overdue = !l.returned_at && l.overdue_days > 0;
                return (
                  <tr key={l.id}>
                    <td><strong>{l.title}</strong><div className="hint">{l.author} · {l.barcode}</div></td>
                    <td>{new Date(l.loaned_at).toLocaleDateString('he-IL')}</td>
                    <td>{new Date(l.due_date).toLocaleDateString('he-IL')}</td>
                    <td>{l.returned_at ? new Date(l.returned_at).toLocaleDateString('he-IL') : '—'}</td>
                    <td>
                      {l.returned_at ? (
                        <span className="status-badge s-available">הוחזר</span>
                      ) : overdue ? (
                        <span className="status-badge s-overdue">באיחור {l.overdue_days} ימים</span>
                      ) : (
                        <span className="status-badge s-loaned">אצלך</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
