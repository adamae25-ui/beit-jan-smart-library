import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api.js';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/stats/dashboard').then(setStats).catch((e) => setError(e.message));
  }, []);

  const v = (x) => (stats ? Number(x ?? 0) : '…');

  // Each card carries an optional "to" path — clicking it navigates to the
  // matching screen so the number is never a dead end.
  const cards =
    user.role === 'student'
      ? [
          { label: 'ספרים אצלי',     value: v(stats?.active_loans),        to: '/history' },
          { label: 'שריונים פעילים', value: v(stats?.active_reservations), to: '/reservations' },
          { label: 'להחזרה השבוע',   value: v(stats?.due_this_week),       to: '/history' },
          { label: 'באיחור',         value: v(stats?.overdue), warn: Number(stats?.overdue) > 0, to: '/history' },
        ]
      : [
          { label: 'השאלות פעילות',   value: v(stats?.active_loans), to: '/monitor' },
          { label: 'איחורים',          value: v(stats?.overdue), warn: Number(stats?.overdue) > 0, to: '/monitor?filter=overdue' },
          { label: 'שריונים ממתינים', value: v(stats?.active_reservations), to: '/monitor?tab=reservations' },
          {
            label: 'ספרים זמינים',
            value: stats ? `${Number(stats.available_books ?? 0)}/${Number(stats.total_books ?? 0)}` : '…',
            to: user.role === 'librarian' ? '/inventory' : '/reports',
          },
        ];

  const sub = {
    librarian: 'לוח הבקרה של הספרייה',
    student: 'הספרים והשריונים שלך',
    management: 'מבט-על על פעילות הספרייה',
  }[user.role];

  return (
    <div className="page">
      <header className="page-head">
        <h1>שלום, {user.name} 👋</h1>
        <p className="page-sub">{sub}</p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        {cards.map((card) => (
          <button
            className={`stat-card clickable ${card.warn ? 'warn' : ''}`}
            key={card.label}
            onClick={() => navigate(card.to)}
            aria-label={`${card.label}: מעבר למסך המפורט`}
          >
            <div className="stat-value">{card.value}</div>
            <div className="stat-label">{card.label}</div>
            <div className="stat-arrow" aria-hidden="true">←</div>
          </button>
        ))}
      </div>

      {user.role === 'librarian' && (
        <div className="phase-note">
          <strong>פעולות מהירות:</strong> השאלת ספר והחזרת ספר זמינות בסרגל הצד.
          לחצו על כל אחד מהכרטיסים למעלה כדי לעבור למסך המפורט.
        </div>
      )}
    </div>
  );
}
