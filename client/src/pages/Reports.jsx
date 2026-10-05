import { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';

const GENRE_HE = {
  study: 'לימוד', science: 'מדע', literature: 'ספרות',
  history: 'היסטוריה', technology: 'טכנולוגיה', other: 'אחר',
};
const GENRE_OPTIONS = [
  { key: '', label: 'כל הקטגוריות' },
  ...Object.entries(GENRE_HE).map(([key, label]) => ({ key, label })),
];
const REASON_HE = { overdue: 'איחור', damage: 'נזק', lost: 'אבדן' };
const TYPE_OPTIONS = [
  { key: 'all', label: 'כל ההשאלות' },
  { key: 'active', label: 'השאלות פעילות' },
  { key: 'overdue', label: 'איחורים' },
  { key: 'debts', label: 'חובות וחוסרים' },
];

function Bar({ label, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}

export default function Reports() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [genre, setGenre] = useState('');
  const [type, setType] = useState('all');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  function buildParams() {
    const p = new URLSearchParams();
    if (dateFrom) p.set('from', dateFrom);
    if (dateTo) p.set('to', dateTo);
    if (genre) p.set('genre', genre);
    if (type !== 'all') p.set('type', type);
    return p;
  }

  async function load(e) {
    e?.preventDefault();
    setError('');
    try {
      setD(await api(`/reports/summary?${buildParams()}`));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportCsv() {
    setExporting(true);
    setError('');
    try {
      const res = await fetch(`/api/reports/export?${buildParams()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'שגיאה בהפקת הדוח');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `דוח-${TYPE_OPTIONS.find((t) => t.key === type)?.label || 'השאלות'}-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  if (error && !d) return <div className="page"><div className="form-error">{error}</div></div>;
  if (!d) return <div className="page"><p className="hint">טוען דוחות…</p></div>;

  const overdueRate = d.overdue_stats.total_loans > 0
    ? Math.round((Number(d.overdue_stats.overdue_loans) / d.overdue_stats.total_loans) * 100)
    : 0;

  const isDebtsView = d.type === 'debts';
  const maxMonth = !isDebtsView ? Math.max(...d.loans_per_month.map((m) => m.loans), 1) : 0;
  const maxGenre = !isDebtsView ? Math.max(...d.by_genre.map((g) => g.loans), 1) : 0;
  const maxClass = !isDebtsView ? Math.max(...d.by_class.map((c) => c.loans), 1) : 0;

  return (
    <div className="page">
      <header className="page-head">
        <h1>דוחות</h1>
        <p className="page-sub">פעילות הספרייה - השאלות, איחורים וחובות</p>
      </header>

      <form onSubmit={load} className="report-filters">
        <label>
          סוג דוח
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label>
          מתאריך
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          עד תאריך
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label>
          קטגוריה
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            {GENRE_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <button className="btn-primary" type="submit">הצגת נתונים</button>
        <button
          className="btn-ghost"
          type="button"
          onClick={exportCsv}
          disabled={exporting}
        >
          {exporting ? 'מפיק דוח…' : '⬇️ הפקת דוח (CSV)'}
        </button>
      </form>

      {(!dateFrom && !dateTo) && (
        <p className="hint">לא נבחר טווח תאריכים - מוצגים נתוני 6 החודשים האחרונים.</p>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{d.overdue_stats.total_loans}</div>
          <div className="stat-label">סה"כ השאלות (כללי)</div>
        </div>
        <div className={`stat-card ${overdueRate > 20 ? 'warn' : ''}`}>
          <div className="stat-value">{overdueRate}%</div>
          <div className="stat-label">שיעור איחורים (כללי)</div>
        </div>
        <div className={`stat-card ${Number(d.debt_stats.open_debts) > 0 ? 'warn' : ''}`}>
          <div className="stat-value">{d.debt_stats.open_debts}</div>
          <div className="stat-label">חובות פתוחים (כללי)</div>
        </div>
      </div>

      {isDebtsView ? (
        <section className="panel debts-report-panel">
          <h3>רשימת חובות וחוסרים ({d.debts.length})</h3>
          {d.debts.length === 0 && <p className="hint">אין חובות התואמים את הסינון שנבחר.</p>}
          {d.debts.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>תאריך</th><th>סיבה</th><th>ספר</th><th>תלמיד</th>
                    <th>כיתה</th><th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {d.debts.map((deb) => (
                    <tr key={deb.id}>
                      <td>{new Date(deb.created_at).toLocaleDateString('he-IL')}</td>
                      <td>{REASON_HE[deb.reason] || deb.reason}</td>
                      <td><strong>{deb.title || '—'}</strong><div className="hint">{deb.barcode}</div></td>
                      <td>{deb.student_name}</td>
                      <td>{deb.class_name}</td>
                      <td>
                        {deb.settled_at
                          ? <span className="status-badge s-available">הוסדר</span>
                          : <span className="status-badge s-damaged">פתוח</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <div className="report-grid">
          <section className="panel">
            <h3>השאלות לפי חודש</h3>
            {d.loans_per_month.length === 0 && <p className="hint">אין נתונים לטווח שנבחר.</p>}
            {d.loans_per_month.map((m) => (
              <Bar key={m.month} label={m.month} value={m.loans} max={maxMonth} />
            ))}
          </section>

          <section className="panel">
            <h3>השאלות לפי ז'אנר</h3>
            {d.by_genre.length === 0 && <p className="hint">אין נתונים לטווח שנבחר.</p>}
            {d.by_genre.map((g) => (
              <Bar key={g.genre} label={GENRE_HE[g.genre] || g.genre} value={g.loans} max={maxGenre} />
            ))}
          </section>

          <section className="panel">
            <h3>פעילות לפי כיתה</h3>
            {d.by_class.length === 0 && <p className="hint">אין נתונים לטווח שנבחר.</p>}
            {d.by_class.map((c) => (
              <Bar key={c.class_name} label={c.class_name} value={c.loans} max={maxClass} />
            ))}
          </section>

          <section className="panel">
            <h3>הספרים המבוקשים ביותר</h3>
            {d.top_books.length === 0 && <p className="hint">אין נתונים לטווח שנבחר.</p>}
            <ol className="top-books">
              {d.top_books.map((b, i) => (
                <li key={i}>
                  <strong>{b.title}</strong>
                  <span className="hint"> {b.author || ''} · {b.times} השאלות</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
