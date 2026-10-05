import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AssistantWidget from './AssistantWidget.jsx';
import IdleWarning from './IdleWarning.jsx';
import { api } from '../api.js';
import { toggleTheme } from '../theme.js';

/**
 * Sidebar items per role - matches the mockup's navigation.
 */
const NAV = {
  librarian: [
    { to: '/',            label: 'לוח בקרה',      icon: '🏠' },
    { to: '/monitor',     label: 'מעקב חי',        icon: '📡' },
    { to: '/loan',        label: 'השאלת ספר',     icon: '📤' },
    { to: '/return',      label: 'החזרת ספר',     icon: '📥' },
    { to: '/inventory',   label: 'ניהול מלאי',    icon: '📦' },
    { to: '/students',    label: 'תלמידים',       icon: '🎓' },
    { to: '/notifications', label: 'יומן התראות', icon: '📨' },
    { to: '/reports',     label: 'דוחות',         icon: '📊' },
    { to: '/settings',    label: 'הגדרות',        icon: '⚙️' },
  ],
  student: [
    { to: '/',            label: 'הספרים שלי',    icon: '📚' },
    { to: '/search',      label: 'חיפוש ספרים',   icon: '🔍' },
    { to: '/reservations',label: 'השריונים שלי',  icon: '🔖' },
    { to: '/history',     label: 'היסטוריה',      icon: '🕘' },
  ],
  management: [
    { to: '/',            label: 'לוח בקרה',      icon: '🏠' },
    { to: '/monitor',     label: 'מעקב חי',        icon: '📡' },
    { to: '/reports',     label: 'דוחות',         icon: '📊' },
  ],
};

const ROLE_LABEL = { librarian: 'ספרנית', student: 'תלמיד/ה', management: 'הנהלה' };

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV[user.role] || [];
  const [timeoutMinutes, setTimeoutMinutes] = useState(null);
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light'
  );

  useEffect(() => {
    api('/auth/session-timeout')
      .then((d) => setTimeoutMinutes(d.minutes))
      .catch(() => setTimeoutMinutes(15));
  }, []);

  function onLogout() {
    logout();
    navigate('/login');
  }

  function onToggleTheme() {
    setTheme(toggleTheme());
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon" aria-hidden="true">📖</span>
          <div>
            <div className="brand-name">Smart Library</div>
            <div className="brand-sub">תיכון בית ג'ן</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="ניווט ראשי">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="user-name">{user.name}</div>
          <div className="user-role">{ROLE_LABEL[user.role]}</div>
          <button
            className="btn-ghost theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
          >
            {theme === 'dark' ? '☀️ מצב בהיר' : '🌙 מצב כהה'}
          </button>
          <button className="btn-ghost" onClick={onLogout}>יציאה</button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>

      <AssistantWidget />
      {timeoutMinutes ? <IdleWarning timeoutMinutes={timeoutMinutes} /> : null}
    </div>
  );
}
