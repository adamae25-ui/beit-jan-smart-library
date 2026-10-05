import { useNavigate } from 'react-router-dom';
import { useIdleTimeout } from '../auth/useIdleTimeout.js';
import { useAuth } from '../auth/AuthContext.jsx';

const WARN_SECONDS = 60;

/**
 * Renders nothing until the user has been idle for (timeoutMinutes - 1min),
 * then shows a countdown overlay. If the countdown reaches zero the user
 * is logged out automatically; any activity (or clicking "Continue") cancels it.
 */
export default function IdleWarning({ timeoutMinutes }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleTimeout() {
    logout();
    navigate('/login?reason=idle');
  }

  const { warning, secondsLeft, stayLoggedIn } = useIdleTimeout(
    timeoutMinutes,
    WARN_SECONDS,
    handleTimeout
  );

  if (!warning) return null;

  return (
    <div className="idle-overlay" role="alertdialog" aria-label="אזהרת ניתוק אוטומטי">
      <div className="idle-box">
        <div className="idle-icon" aria-hidden="true">⏳</div>
        <h2>עדיין כאן?</h2>
        <p>תנותק/י אוטומטית בעוד <strong>{secondsLeft}</strong> שניות עקב חוסר פעילות.</p>
        <button className="btn-primary" onClick={stayLoggedIn}>המשך עבודה</button>
      </div>
    </div>
  );
}
