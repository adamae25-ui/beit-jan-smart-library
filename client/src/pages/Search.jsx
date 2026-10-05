import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const GENRES = [
  { key: '',           label: 'כל הז\'אנרים' },
  { key: 'study',      label: 'לימוד' },
  { key: 'science',    label: 'מדע' },
  { key: 'literature', label: 'ספרות' },
  { key: 'history',    label: 'היסטוריה' },
  { key: 'technology', label: 'טכנולוגיה' },
  { key: 'other',      label: 'אחר' },
];

const STATUS_HE = {
  available: 'זמין', loaned: 'מושאל', reserved: 'משוריין', damaged: 'פגום',
};

export default function Search() {
  const { user } = useAuth();
  const [term, setTerm] = useState('');
  const [genre, setGenre] = useState('');
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);   // { type: 'ok'|'err', text }
  const [busy, setBusy] = useState(false);

  async function run(e) {
    e?.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const params = new URLSearchParams();
      if (term.trim()) params.set('q', term.trim());
      if (genre) params.set('genre', genre);
      setData(await api(`/books/search?${params}`));
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
    finally { setBusy(false); }
  }

  useEffect(() => { run(); }, []); // initial load: full catalog

  async function reserve(book) {
    setMsg(null);
    try {
      const r = await api('/reservations', { method: 'POST', body: { barcode: book.barcode } });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
      run();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>חיפוש ספרים</h1>
        <p className="page-sub">חיפוש בקטלוג הספרייה ושריון ספרים זמינים</p>
      </header>

      <form onSubmit={run} className="search-bar">
        <input
          placeholder="שם ספר, מחבר, ברקוד או ISBN"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          {GENRES.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <button className="btn-primary" disabled={busy}>חיפוש</button>
      </form>

      {msg && (
        <div className={msg.type === 'ok' ? 'ok-note' : 'form-error'} role="alert">
          {msg.text}
        </div>
      )}

      {data && (
        <>
          <p className="hint">{data.total} תוצאות</p>
          <div className="book-grid">
            {data.books.map((b) => (
              <div className="book-tile" key={b.id}>
                <div className="book-tile-head">
                  <h3>{b.title}</h3>
                  <span className={`status-badge s-${b.status}`}>{STATUS_HE[b.status]}</span>
                </div>
                <p>{b.author || '—'} {b.publish_year ? `· ${b.publish_year}` : ''}</p>
                <p className="hint">מדף {b.shelf_location} · {b.barcode}</p>
                {user.role === 'student' && b.status === 'available' && (
                  <button className="btn-primary sm" onClick={() => reserve(b)}>
                    שריון ל-48 שעות
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
