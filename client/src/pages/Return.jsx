import { useState } from 'react';
import { api } from '../api.js';

const CONDITIONS = [
  { key: 'ok',             label: 'תקין' },
  { key: 'partially_torn', label: 'קרוע חלקית' },
  { key: 'missing_pages',  label: 'דפים חסרים' },
  { key: 'badly_damaged',  label: 'פגום קשה' },
];

/**
 * Return flow (spec 1.7.2):
 * barcode -> active loan details + overdue days -> condition -> confirm.
 * Overdue/damage automatically creates a debt (server side).
 */
export default function Return() {
  const [barcode, setBarcode] = useState('');
  const [book, setBook] = useState(null);
  const [condition, setCondition] = useState('ok');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function findBook(e) {
    e.preventDefault();
    setError(''); setBusy(true); setBook(null);
    try {
      const b = await api(`/lookup/book?barcode=${encodeURIComponent(barcode.trim())}`);
      if (!b.active_loan) {
        setError('לא נמצאה השאלה פעילה לספר זה');
      } else {
        setBook(b);
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function confirmReturn() {
    setError(''); setBusy(true);
    try {
      const r = await api('/loans/return', {
        method: 'POST',
        body: { barcode: book.barcode, condition, notes: notes || null },
      });
      setResult(r);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function reset() {
    setBarcode(''); setBook(null); setCondition('ok');
    setNotes(''); setResult(null); setError('');
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>החזרת ספר</h1>
        <p className="page-sub">סריקת ברקוד ← בדיקת מצב ← אישור</p>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      {!result && (
        <section className="panel">
          <form onSubmit={findBook} className="inline-form">
            <input
              placeholder="ברקוד ספר (למשל BK-0001)"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
              required
            />
            <button className="btn-primary" disabled={busy}>איתור השאלה</button>
          </form>

          {book && book.active_loan && (
            <>
              <div className="book-card">
                <h3>{book.title}</h3>
                <p>{book.author} · {book.barcode}</p>
                <p>
                  מושאל ל: <strong>{book.active_loan.student_name}</strong>{' '}
                  ({book.active_loan.class_name})
                </p>
                <p>
                  תאריך החזרה: {new Date(book.active_loan.due_date).toLocaleDateString('he-IL')}
                  {book.active_loan.overdue_days > 0 ? (
                    <span className="status-badge s-overdue">
                      {' '}איחור {book.active_loan.overdue_days} ימים
                    </span>
                  ) : (
                    <span className="status-badge s-available"> במועד</span>
                  )}
                </p>
              </div>

              <fieldset className="condition-set">
                <legend>מצב הספר בהחזרה</legend>
                <div className="condition-grid">
                  {CONDITIONS.map((c) => (
                    <label key={c.key} className={`condition-opt ${condition === c.key ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="condition"
                        value={c.key}
                        checked={condition === c.key}
                        onChange={() => setCondition(c.key)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {condition !== 'ok' && (
                <label className="notes-label">
                  הערות נזק
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="תיאור קצר של הנזק"
                  />
                </label>
              )}

              {(book.active_loan.overdue_days > 0 || condition !== 'ok') && (
                <div className="warn-note">
                  ⚠️ החזרה זו תיצור חוב לתלמיד
                  {book.active_loan.overdue_days > 0 && ' (איחור)'}
                  {condition !== 'ok' && ' (נזק)'}
                  {' '}— התלמיד ייחסם מהשאלות חדשות עד הסדרה.
                </div>
              )}

              <button className="btn-primary" onClick={confirmReturn} disabled={busy}>
                אישור החזרה
              </button>
            </>
          )}
        </section>
      )}

      {result && (
        <section className="panel success-panel">
          <div className="success-icon" aria-hidden="true">✅</div>
          <h2>{result.message}</h2>
          <p><strong>{result.book}</strong> הוחזר ע"י <strong>{result.student}</strong></p>
          <p>
            להחזרה למדף: <strong className="shelf-tag">{result.shelf_location}</strong>
          </p>
          {result.overdue_days > 0 && <p>נרשם איחור של {result.overdue_days} ימים</p>}
          {result.debts_created.length > 0 && (
            <p className="warn-note">נוצר חוב לתלמיד ({result.debts_created.join(', ')})</p>
          )}
          <button className="btn-primary" onClick={reset}>החזרה נוספת</button>
        </section>
      )}
    </div>
  );
}
