import { useEffect, useState } from 'react';
import { api } from '../api.js';

const REASON_HE = { overdue: 'איחור', damage: 'נזק', lost: 'אבדן' };
const CHANNEL_HE = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'אימייל' };

export default function Students() {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);      // student id whose debts are open
  const [debts, setDebts] = useState(null);
  const [note, setNote] = useState('');
  const [settling, setSettling] = useState(null); // debt id being settled
  const [msg, setMsg] = useState(null);

  // manual notification compose state
  const [notifyFor, setNotifyFor] = useState(null);
  const [notifyText, setNotifyText] = useState('');
  const [notifyChannel, setNotifyChannel] = useState('');
  const [sending, setSending] = useState(false);

  // contact-edit compose state
  const [editFor, setEditFor] = useState(null);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  // add-student form state
  const EMPTY_STUDENT = {
    full_name: '', student_number: '', national_id: '', class_name: '',
    username: '', password: '', phone: '', email: '', max_loans: '3',
  };
  const [newStudent, setNewStudent] = useState(null);
  const [savingNew, setSavingNew] = useState(false);

  async function load(e) {
    e?.preventDefault();
    const params = term.trim() ? `?q=${encodeURIComponent(term.trim())}` : '';
    try { setRows(await api(`/admin/students${params}`)); }
    catch (err) { setMsg({ type: 'err', text: err.message }); }
  }
  useEffect(() => { load(); }, []);

  async function toggleDebts(studentId) {
    if (open === studentId) { setOpen(null); setDebts(null); return; }
    setOpen(studentId); setDebts(null); setMsg(null);
    try { setDebts(await api(`/admin/students/${studentId}/debts`)); }
    catch (err) { setMsg({ type: 'err', text: err.message }); }
  }

  async function settle(debtId) {
    if (!note.trim()) return setMsg({ type: 'err', text: 'חובה לציין הנמקה להסדרת החוב' });
    setMsg(null);
    try {
      const r = await api(`/admin/debts/${debtId}/settle`, { method: 'POST', body: { note } });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
      setNote(''); setSettling(null);
      setDebts(await api(`/admin/students/${open}/debts`));
      load();
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  }

  function openNotify(studentId) {
    setNotifyFor(notifyFor === studentId ? null : studentId);
    setNotifyText('');
    setNotifyChannel('');
    setMsg(null);
  }

  async function sendNotify(studentId) {
    if (!notifyText.trim()) return setMsg({ type: 'err', text: 'יש להזין תוכן להודעה' });
    setSending(true); setMsg(null);
    try {
      const body = { message: notifyText.trim() };
      if (notifyChannel) body.channel = notifyChannel;
      const r = await api(`/admin/students/${studentId}/notify`, { method: 'POST', body });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
      setNotifyFor(null); setNotifyText('');
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setSending(false);
    }
  }

  function openEdit(student) {
    if (editFor === student.id) { setEditFor(null); return; }
    setEditFor(student.id);
    setEditPhone(student.phone || '');
    setEditEmail(student.email || '');
    setMsg(null);
  }

  async function saveContact(studentId) {
    setSavingContact(true); setMsg(null);
    try {
      const r = await api(`/admin/students/${studentId}/contact`, {
        method: 'PUT',
        body: { phone: editPhone, email: editEmail },
      });
      setMsg({ type: 'ok', text: `✅ ${r.message}` });
      setEditFor(null);
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setSavingContact(false);
    }
  }

  const nf = (k) => (e) => setNewStudent({ ...newStudent, [k]: e.target.value });

  async function saveNewStudent(e) {
    e.preventDefault();
    setSavingNew(true); setMsg(null);
    try {
      const r = await api('/admin/students', { method: 'POST', body: newStudent });
      setMsg({ type: 'ok', text: `\u2705 ${r.message}` });
      setNewStudent(null);
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setSavingNew(false);
    }
  }

  async function removeStudent(s) {
    if (!confirm(`\u05dc\u05d4\u05e1\u05d9\u05e8 \u05d0\u05ea ${s.full_name} \u05de\u05e8\u05e9\u05d9\u05de\u05ea \u05d4\u05ea\u05dc\u05de\u05d9\u05d3\u05d9\u05dd \u05d4\u05e4\u05e2\u05d9\u05dc\u05d9\u05dd?`)) return;
    setMsg(null);
    try {
      const r = await api(`/admin/students/${s.id}`, { method: 'DELETE' });
      setMsg({ type: 'ok', text: `\u2705 ${r.message}` });
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>ניהול תלמידים</h1>
        <p className="page-sub">מצב השאלות וחובות, פרטי קשר, והתראות ידניות</p>
      </header>

      <div className="toolbar">
        <form onSubmit={load} className="search-bar grow">
          <input placeholder="שם, מספר תלמיד או כיתה" value={term} onChange={(e) => setTerm(e.target.value)} />
          <button className="btn-primary">חיפוש</button>
        </form>
        <button
          className="btn-primary"
          onClick={() => setNewStudent(newStudent ? null : { ...EMPTY_STUDENT })}
        >
          {newStudent ? 'סגירה' : '+ תלמיד חדש'}
        </button>
      </div>

      {newStudent && (
        <form onSubmit={saveNewStudent} className="panel add-book-form">
          <h3>הוספת תלמיד חדש</h3>
          <div className="form-grid">
            <label>שם מלא *<input value={newStudent.full_name} onChange={nf('full_name')} required /></label>
            <label>מספר תלמיד *<input value={newStudent.student_number} onChange={nf('student_number')} required /></label>
            <label>ת.ז (אם שונה)<input value={newStudent.national_id} onChange={nf('national_id')} /></label>
            <label>כיתה *<input value={newStudent.class_name} onChange={nf('class_name')} required /></label>
            <label>שם משתמש *<input value={newStudent.username} onChange={nf('username')} required /></label>
            <label>סיסמה ראשונית *<input type="text" value={newStudent.password} onChange={nf('password')} placeholder="לפחות 6 תווים" required /></label>
            <label>טלפון<input value={newStudent.phone} onChange={nf('phone')} placeholder="972501234567+" /></label>
            <label>אימייל<input value={newStudent.email} onChange={nf('email')} /></label>
            <label>מכסת השאלות<input type="number" min="1" max="20" value={newStudent.max_loans} onChange={nf('max_loans')} /></label>
          </div>
          <button className="btn-primary" disabled={savingNew}>
            {savingNew ? 'שומר…' : 'הוספת תלמיד'}
          </button>
        </form>
      )}

      {msg && <div className={msg.type === 'ok' ? 'ok-note' : 'form-error'} role="alert">{msg.text}</div>}

      {rows && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>תלמיד</th><th>כיתה</th><th>מס' תלמיד</th><th>השאלות פעילות</th><th>חובות</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <>
                  <tr key={s.id}>
                    <td><strong>{s.full_name}</strong><div className="hint">{s.phone || 'אין טלפון'}</div></td>
                    <td>{s.class_name}</td>
                    <td>{s.student_number}</td>
                    <td>{s.active_loans}/{s.max_loans}</td>
                    <td>
                      {Number(s.open_debts) > 0 ? (
                        <span className="status-badge s-damaged">{s.open_debts} פתוחים</span>
                      ) : (
                        <span className="status-badge s-available">אין</span>
                      )}
                    </td>
                    <td className="row-actions">
                      <button className="btn-ghost sm" onClick={() => toggleDebts(s.id)}>
                        {open === s.id ? 'סגירת חובות' : 'חובות'}
                      </button>
                      <button className="btn-ghost sm" onClick={() => openEdit(s)}>
                        {editFor === s.id ? 'סגירה' : '✏️ פרטי קשר'}
                      </button>
                      <button className="btn-ghost sm" onClick={() => openNotify(s.id)}>
                        {notifyFor === s.id ? 'סגירה' : '📨 הודעה'}
                      </button>
                      <button className="btn-ghost sm danger" onClick={() => removeStudent(s)}>
                        🗑 הסרה
                      </button>
                    </td>
                  </tr>

                  {editFor === s.id && (
                    <tr key={`${s.id}-edit`}>
                      <td colSpan="6" className="debts-cell">
                        <div className="notify-compose">
                          <input
                            placeholder="972501234567+ (פורמט בינלאומי חובה)"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            autoFocus
                          />
                          <input
                            placeholder="אימייל"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                          />
                          <button
                            className="btn-primary sm"
                            onClick={() => saveContact(s.id)}
                            disabled={savingContact}
                          >
                            {savingContact ? 'שומר…' : 'שמירה'}
                          </button>
                        </div>
                        <div className="hint">חובה פורמט בינלאומי מלא (למשל 972501234567+) - אחרת ה-SMS/WhatsApp לא יגיעו ליעד הנכון.</div>
                      </td>
                    </tr>
                  )}

                  {notifyFor === s.id && (
                    <tr key={`${s.id}-notify`}>
                      <td colSpan="6" className="debts-cell">
                        <div className="notify-compose">
                          <input
                            placeholder={`הודעה ל${s.full_name}...`}
                            value={notifyText}
                            onChange={(e) => setNotifyText(e.target.value)}
                            maxLength={300}
                            autoFocus
                          />
                          <select value={notifyChannel} onChange={(e) => setNotifyChannel(e.target.value)}>
                            <option value="">ערוץ ברירת מחדל</option>
                            {Object.entries(CHANNEL_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <button
                            className="btn-primary sm"
                            onClick={() => sendNotify(s.id)}
                            disabled={sending || !notifyText.trim()}
                          >
                            {sending ? 'שולח…' : 'שליחה'}
                          </button>
                        </div>
                        <div className="hint">{notifyText.length}/300 תווים</div>
                      </td>
                    </tr>
                  )}

                  {open === s.id && (
                    <tr key={`${s.id}-debts`}>
                      <td colSpan="6" className="debts-cell">
                        {!debts && <span className="hint">טוען…</span>}
                        {debts && debts.length === 0 && <span className="hint">אין חובות לתלמיד זה.</span>}
                        {debts && debts.map((d) => (
                          <div key={d.id} className={`debt-item ${d.settled_at ? 'settled' : ''}`}>
                            <div>
                              <strong>{REASON_HE[d.reason]}</strong> · {d.description}
                              <div className="hint">
                                נוצר: {new Date(d.created_at).toLocaleDateString('he-IL')}
                                {d.settled_at && ` · הוסדר: ${new Date(d.settled_at).toLocaleDateString('he-IL')} ע"י ${d.settled_by_name} — "${d.settle_note}"`}
                              </div>
                            </div>
                            {!d.settled_at && (
                              settling === d.id ? (
                                <div className="settle-form">
                                  <input
                                    placeholder="הנמקה (חובה)"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    autoFocus
                                  />
                                  <button className="btn-primary sm" onClick={() => settle(d.id)}>אישור</button>
                                  <button className="btn-ghost sm" onClick={() => { setSettling(null); setNote(''); }}>ביטול</button>
                                </div>
                              ) : (
                                <button className="btn-ghost sm" onClick={() => setSettling(d.id)}>הסדרה</button>
                              )
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
