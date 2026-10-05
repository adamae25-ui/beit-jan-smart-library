import { useState } from 'react';
import { api } from '../api.js';

/**
 * Loan wizard (spec 1.7.1):
 * Step 1 - identify student + eligibility panel
 * Step 2 - scan/type book barcode
 * Step 3 - confirm -> success with due date
 */
export default function Loan() {
  const [step, setStep] = useState(1);
  const [term, setTerm] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [student, setStudent] = useState(null);
  const [barcode, setBarcode] = useState('');
  const [book, setBook] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function findStudent(e) {
    e.preventDefault();
    setError(''); setBusy(true); setCandidates([]);
    try {
      const rows = await api(`/lookup/student?q=${encodeURIComponent(term.trim())}`);
      if (rows.length === 1) selectStudent(rows[0]);
      else setCandidates(rows);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function selectStudent(s) {
    setStudent(s);
    setCandidates([]);
    if (s.eligible) setStep(2);
  }

  async function findBook(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const b = await api(`/lookup/book?barcode=${encodeURIComponent(barcode.trim())}`);
      setBook(b);
      setStep(3);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function confirmLoan() {
    setError(''); setBusy(true);
    try {
      const r = await api('/loans', {
        method: 'POST',
        body: { student_user_id: student.id, barcode: book.barcode },
      });
      setResult(r);
      setStep(4);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function reset() {
    setStep(1); setTerm(''); setStudent(null); setBarcode('');
    setBook(null); setResult(null); setError(''); setCandidates([]);
  }

  const bookLoanable =
    book && (book.status === 'available' ||
      (book.status === 'reserved' && book.active_reservation?.student_user_id === student?.id));

  return (
    <div className="page">
      <header className="page-head">
        <h1>השאלת ספר</h1>
        <p className="page-sub">זיהוי תלמיד ← סריקת ספר ← אישור</p>
      </header>

      <div className="steps-bar" aria-hidden="true">
        {['תלמיד', 'ספר', 'אישור'].map((label, i) => (
          <span key={label} className={`step-dot ${step > i ? 'done' : ''} ${step === i + 1 ? 'now' : ''}`}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      {/* ---- Step 1: student ---- */}
      {step === 1 && (
        <section className="panel">
          <form onSubmit={findStudent} className="inline-form">
            <input
              placeholder="מספר תלמיד / ת.ז / שם"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              autoFocus
              required
            />
            <button className="btn-primary" disabled={busy}>חיפוש</button>
          </form>

          {candidates.length > 1 && (
            <ul className="candidate-list">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button className="candidate" onClick={() => selectStudent(c)}>
                    {c.full_name} · {c.class_name} · {c.student_number}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {student && !student.eligible && (
            <div className="eligibility blocked">
              <strong>{student.full_name}</strong> ({student.class_name})
              <p>⛔ {student.block_reason}</p>
              {student.open_debts.map((d) => (
                <p key={d.id} className="debt-line">חוב: {d.description}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---- Step 2: book ---- */}
      {step === 2 && (
        <section className="panel">
          <div className="eligibility ok">
            ✅ <strong>{student.full_name}</strong> ({student.class_name}) —
            {' '}רשאי/ת להשאיל · {student.active_loans.length}/{student.max_loans} השאלות פעילות
          </div>
          <form onSubmit={findBook} className="inline-form">
            <input
              placeholder="ברקוד ספר (למשל BK-0001)"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
              required
            />
            <button className="btn-primary" disabled={busy}>בדיקה</button>
          </form>
          <button className="btn-ghost" onClick={reset}>החלפת תלמיד</button>
        </section>
      )}

      {/* ---- Step 3: confirm ---- */}
      {step === 3 && book && (
        <section className="panel">
          <div className="book-card">
            <h3>{book.title}</h3>
            <p>{book.author} · מדף {book.shelf_location} · {book.barcode}</p>
            <p>
              סטטוס:{' '}
              <span className={`status-badge s-${book.status}`}>
                {{ available: 'זמין', loaned: 'מושאל', reserved: 'משוריין', damaged: 'פגום', removed: 'הוסר' }[book.status]}
              </span>
            </p>
            {book.status === 'reserved' && (
              <p className="hint">
                משוריין ל: {book.active_reservation?.student_name}
                {bookLoanable && ' (זה התלמיד הנוכחי - ניתן להשאיל)'}
              </p>
            )}
          </div>

          {bookLoanable ? (
            <button className="btn-primary" onClick={confirmLoan} disabled={busy}>
              אישור השאלה ל{student.full_name}
            </button>
          ) : (
            <div className="form-error">לא ניתן להשאיל ספר זה</div>
          )}
          <button className="btn-ghost" onClick={() => { setStep(2); setBook(null); }}>ספר אחר</button>
        </section>
      )}

      {/* ---- Step 4: success ---- */}
      {step === 4 && result && (
        <section className="panel success-panel">
          <div className="success-icon" aria-hidden="true">🎉</div>
          <h2>{result.message}</h2>
          <p><strong>{result.book}</strong> הושאל ל<strong>{result.student}</strong></p>
          <p>תאריך החזרה: <strong>{new Date(result.due_date).toLocaleDateString('he-IL')}</strong></p>
          <p className="hint">אישור נשלח לתלמיד (WhatsApp/SMS/Email)</p>
          <button className="btn-primary" onClick={reset}>השאלה חדשה</button>
        </section>
      )}
    </div>
  );
}
