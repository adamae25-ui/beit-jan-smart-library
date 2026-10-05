import { useEffect, useState } from 'react';
import { api } from '../api.js';

const GENRES = [
  { key: 'study', label: 'לימוד' }, { key: 'science', label: 'מדע' },
  { key: 'literature', label: 'ספרות' }, { key: 'history', label: 'היסטוריה' },
  { key: 'technology', label: 'טכנולוגיה' }, { key: 'other', label: 'אחר' },
];
const STATUS_HE = {
  available: 'זמין', loaned: 'מושאל', reserved: 'משוריין',
  damaged: 'פגום', removed: 'הוסר',
};
const EMPTY = { barcode: '', title: '', author: '', genre: 'other', shelf_location: '', publish_year: '', isbn: '' };

export default function Inventory() {
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);   // null = closed, EMPTY = add form
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load(e) {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (term.trim()) params.set('q', term.trim());
    if (status) params.set('status', status);
    try { setData(await api(`/books/search?${params}`)); }
    catch (err) { setMsg({ type: 'err', text: err.message }); }
  }
  useEffect(() => { load(); }, []);

  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function autofillFromIsbn() {
    if (!form.isbn.trim()) return setMsg({ type: 'err', text: 'יש להזין ISBN קודם' });
    setBusy(true); setMsg(null);
    try {
      const d = await api(`/enrich/isbn/${encodeURIComponent(form.isbn.trim())}`);
      setForm({
        ...form,
        title: d.title || form.title,
        author: d.author || form.author,
        publish_year: d.publish_year || form.publish_year,
      });
      setMsg({ type: 'ok', text: '✅ הפרטים מולאו מ-Google Books' });
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
    finally { setBusy(false); }
  }

  async function saveBook(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body = { ...form, publish_year: form.publish_year || null };
      const r = await api('/books', { method: 'POST', body });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
      setForm(null);
      load();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
    finally { setBusy(false); }
  }

  async function setBookStatus(book, newStatus, label) {
    if (!confirm(`${label} - "${book.title}"?`)) return;
    setMsg(null);
    try {
      await api(`/books/${book.id}`, { method: 'PUT', body: { status: newStatus } });
      setMsg({ type: 'ok', text: '✅ הסטטוס עודכן' });
      load();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>ניהול מלאי</h1>
        <p className="page-sub">קטלוג הספרייה - הוספה, תיקון והסרה</p>
      </header>

      <div className="toolbar">
        <form onSubmit={load} className="search-bar grow">
          <input placeholder="שם, מחבר, ברקוד או ISBN" value={term} onChange={(e) => setTerm(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">כל הסטטוסים</option>
            {Object.entries(STATUS_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn-primary" type="submit">סינון</button>
        </form>
        <button className="btn-primary" onClick={() => setForm(form ? null : { ...EMPTY })}>
          {form ? 'סגירה' : '+ ספר חדש'}
        </button>
      </div>

      {msg && <div className={msg.type === 'ok' ? 'ok-note' : 'form-error'} role="alert">{msg.text}</div>}

      {form && (
        <form onSubmit={saveBook} className="panel add-book-form">
          <h3>הוספת ספר למלאי</h3>
          <div className="form-grid">
            <label>ברקוד *<input value={form.barcode} onChange={f('barcode')} placeholder="BK-0101" required /></label>
            <label>שם הספר *<input value={form.title} onChange={f('title')} required /></label>
            <label>מחבר<input value={form.author} onChange={f('author')} /></label>
            <label>ז'אנר
              <select value={form.genre} onChange={f('genre')}>
                {GENRES.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </label>
            <label>מיקום מדף *<input value={form.shelf_location} onChange={f('shelf_location')} placeholder="A3-12" required /></label>
            <label>שנת הוצאה<input type="number" value={form.publish_year} onChange={f('publish_year')} /></label>
            <label>ISBN
              <div className="isbn-row">
                <input value={form.isbn} onChange={f('isbn')} placeholder="9789650100011" />
                <button type="button" className="btn-ghost sm" onClick={autofillFromIsbn} disabled={busy}>
                  מילוי מ-Google Books
                </button>
              </div>
            </label>
          </div>
          <button className="btn-primary" disabled={busy}>שמירה</button>
        </form>
      )}

      {data && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>ברקוד</th><th>ספר</th><th>ז'אנר</th><th>מדף</th><th>סטטוס</th><th>פעולות</th></tr>
            </thead>
            <tbody>
              {data.books.map((b) => (
                <tr key={b.id}>
                  <td>{b.barcode}</td>
                  <td><strong>{b.title}</strong><div className="hint">{b.author || '—'}</div></td>
                  <td>{GENRES.find((g) => g.key === b.genre)?.label}</td>
                  <td>{b.shelf_location}</td>
                  <td><span className={`status-badge s-${b.status}`}>{STATUS_HE[b.status]}</span></td>
                  <td className="row-actions">
                    {b.status === 'damaged' && (
                      <button className="btn-ghost sm" onClick={() => setBookStatus(b, 'available', 'החזרה למחזור לאחר תיקון')}>תוקן ✔</button>
                    )}
                    {(b.status === 'available' || b.status === 'damaged') && (
                      <button className="btn-ghost sm danger" onClick={() => setBookStatus(b, 'removed', 'הסרה מהמלאי')}>הסרה</button>
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
