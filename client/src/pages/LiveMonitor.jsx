import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import StudentDetailModal from '../components/StudentDetailModal.jsx';

const FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'overdue', label: 'באיחור' },
  { key: 'debt', label: 'עם חוב' },
];

function timeLeft(minutes) {
  if (minutes <= 0) return 'פג';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} שעות ו-${m} דק'` : `${m} דק'`;
}

/**
 * Live monitoring screen for librarian/management:
 *  - Tab 1: active loans, filterable by overdue / has-debt, with search
 *  - Tab 2: active reservations, with requester details (name, class, phone)
 * Clicking a student's name in either table opens their full profile
 * (contact info + every book they need to return) in a popup.
 * Reads ?tab= and ?filter= from the URL so dashboard cards can deep-link here.
 */
export default function LiveMonitor() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'reservations' ? 'reservations' : 'loans');
  const [filter, setFilter] = useState(params.get('filter') || 'all');
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  async function loadLoans() {
    setError('');
    try {
      const p = new URLSearchParams();
      if (filter !== 'all') p.set('filter', filter);
      if (term.trim()) p.set('q', term.trim());
      setRows(await api(`/loans/active?${p}`));
    } catch (e) { setError(e.message); }
  }

  async function loadReservations() {
    setError('');
    try {
      const p = new URLSearchParams();
      if (term.trim()) p.set('q', term.trim());
      setRows(await api(`/reservations/active?${p}`));
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    setRows(null);
    if (tab === 'loans') loadLoans(); else loadReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filter]);

  function search(e) {
    e.preventDefault();
    if (tab === 'loans') loadLoans(); else loadReservations();
  }

  function switchTab(t) {
    setTab(t);
    setTerm('');
    setParams(t === 'reservations' ? { tab: 'reservations' } : {});
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>מעקב חי</h1>
        <p className="page-sub">השאלות פעילות ושריונים בזמן אמת - לחצו על שם תלמיד לפרטים מלאים</p>
      </header>

      <div className="steps-bar" role="tablist" aria-label="בחירת תצוגה">
        <button
          className={`step-dot ${tab === 'loans' ? 'now' : ''}`}
          role="tab"
          aria-selected={tab === 'loans'}
          onClick={() => switchTab('loans')}
        >
          📤 השאלות פעילות
        </button>
        <button
          className={`step-dot ${tab === 'reservations' ? 'now' : ''}`}
          role="tab"
          aria-selected={tab === 'reservations'}
          onClick={() => switchTab('reservations')}
        >
          🔖 שריונים פעילים
        </button>
      </div>

      <form onSubmit={search} className="search-bar">
        <input
          placeholder="חיפוש לפי תלמיד, ספר או ברקוד"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <button className="btn-primary" type="submit">חיפוש</button>
      </form>

      {tab === 'loans' && (
        <div className="toolbar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`filter-chip ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      {rows && rows.length === 0 && <div className="empty-note">אין נתונים להצגה.</div>}

      {rows && rows.length > 0 && tab === 'loans' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>תלמיד</th><th>כיתה</th><th>ספר</th><th>הושאל</th><th>להחזרה</th><th>סטטוס</th><th>חוב</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <button className="student-link" onClick={() => setSelectedStudent(l.student_id)}>
                      {l.student_name}
                    </button>
                    <div className="hint">{l.student_number}</div>
                  </td>
                  <td>{l.class_name}</td>
                  <td><strong>{l.title}</strong><div className="hint">{l.barcode}</div></td>
                  <td>{new Date(l.loaned_at).toLocaleDateString('he-IL')}</td>
                  <td>{new Date(l.due_date).toLocaleDateString('he-IL')}</td>
                  <td>
                    {l.overdue_days > 0
                      ? <span className="status-badge s-overdue">איחור {l.overdue_days} ימים</span>
                      : <span className="status-badge s-loaned">בתוקף</span>}
                  </td>
                  <td>
                    {Number(l.open_debts) > 0
                      ? <span className="status-badge s-damaged">{l.open_debts} חובות</span>
                      : <span className="hint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length > 0 && tab === 'reservations' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>תלמיד</th><th>כיתה</th><th>טלפון</th><th>ספר</th><th>מדף</th><th>שוריין ב-</th><th>נותר</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button className="student-link" onClick={() => setSelectedStudent(r.student_id)}>
                      {r.student_name}
                    </button>
                    <div className="hint">{r.student_number}</div>
                  </td>
                  <td>{r.class_name}</td>
                  <td>{r.phone || '—'}</td>
                  <td><strong>{r.title}</strong><div className="hint">{r.barcode}</div></td>
                  <td>{r.shelf_location}</td>
                  <td>{new Date(r.reserved_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{timeLeft(r.minutes_left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StudentDetailModal studentId={selectedStudent} onClose={() => setSelectedStudent(null)} />
    </div>
  );
}
