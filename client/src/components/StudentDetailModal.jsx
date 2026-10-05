import { useEffect, useState } from 'react';
import { api } from '../api.js';

const REASON_HE = { overdue: 'איחור', damage: 'נזק', lost: 'אבדן' };

/**
 * Popup with a student's full profile: contact info, every book they
 * currently need to return, and open debts. Opened by clicking a student
 * name anywhere it appears (Live Monitor loans/reservations tables).
 */
export default function StudentDetailModal({ studentId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studentId) return;
    setData(null);
    setError('');
    api(`/admin/students/${studentId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [studentId]);

  if (!studentId) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-label="פרטי תלמיד" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="סגירה">✕</button>

        {error && <div className="form-error">{error}</div>}
        {!data && !error && <p className="hint">טוען…</p>}

        {data && (
          <>
            <header className="modal-head">
              <h2>{data.full_name}</h2>
              <p className="hint">{data.class_name} · {data.student_number}</p>
            </header>

            <div className="modal-section">
              <h4>פרטי קשר</h4>
              <p>טלפון: {data.phone || '—'}</p>
              <p>אימייל: {data.email || '—'}</p>
            </div>

            <div className="modal-section">
              <h4>ספרים להחזרה ({data.active_loans.length})</h4>
              {data.active_loans.length === 0 && (
                <p className="hint">אין ספרים פעילים כרגע.</p>
              )}
              {data.active_loans.map((l) => (
                <div key={l.id} className="modal-loan-row">
                  <div>
                    <strong>{l.title}</strong>
                    <div className="hint">{l.author || ''} · {l.barcode} · מדף {l.shelf_location}</div>
                  </div>
                  <div className="modal-loan-due">
                    <div className="hint">עד {new Date(l.due_date).toLocaleDateString('he-IL')}</div>
                    {l.overdue_days > 0 ? (
                      <span className="status-badge s-overdue">איחור {l.overdue_days} ימים</span>
                    ) : (
                      <span className="status-badge s-loaned">בתוקף</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {data.open_debts.length > 0 && (
              <div className="modal-section">
                <h4>חובות פתוחים ({data.open_debts.length})</h4>
                {data.open_debts.map((d) => (
                  <p key={d.id} className="debt-line">
                    <strong>{REASON_HE[d.reason] || d.reason}</strong> — {d.description}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
