import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { toggleTheme } from '../theme.js';

const ROLES = [
  { key: 'librarian',  label: 'ספרנית',  icon: '📚', desc: 'ניהול השאלות, מלאי ודוחות' },
  { key: 'student',    label: 'תלמיד/ה', icon: '🎓', desc: 'חיפוש, שריון ומעקב ספרים' },
  { key: 'management', label: 'הנהלה',   icon: '📊', desc: 'צפייה בדוחות ובקרה' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const idleLogout = searchParams.get('reason') === 'idle';

  const [role, setRole] = useState('librarian');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light'
  );

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password, role);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      {/* Theme toggle is available before signing in too - the sidebar
          toggle only exists once logged in, which left the login screen
          stuck in whatever mode the device defaulted to. */}
      <button
        className="login-theme-toggle"
        onClick={() => setTheme(toggleTheme())}
        aria-label={theme === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <div className="login-card">
        <header className="login-head">
          <div className="login-logo">📖</div>
          <h1>Beit Jan Smart Library</h1>
          <p className="login-sub">מערכת ניהול ספריית תיכון בית ג'ן</p>
        </header>

        {idleLogout && (
          <div className="login-notice">
            נותקת אוטומטית עקב חוסר פעילות. יש להתחבר מחדש.
          </div>
        )}

        <div className="role-grid" role="radiogroup" aria-label="בחירת תפקיד">
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={role === r.key}
              className={`role-card ${role === r.key ? 'selected' : ''}`}
              onClick={() => setRole(r.key)}
            >
              <span className="role-icon" aria-hidden="true">{r.icon}</span>
              <span className="role-label">{r.label}</span>
              <span className="role-desc">{r.desc}</span>
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <label>
            שם משתמש
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            סיסמה
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="btn-primary" disabled={busy}>
            {busy ? 'מתחבר…' : 'כניסה למערכת'}
          </button>
        </form>
      </div>
    </div>
  );
}
