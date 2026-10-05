import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const WELCOME = {
  student:  'היי! אני העוזר החכם של הספרייה 🤖 אפשר לשאול אותי על ספרים, ההשאלות שלך, שריונים ונהלים.',
  librarian:'היי! אני העוזר החכם 🤖 אפשר לשאול אותי על נתוני הספרייה, איתור ספרים ותפעול המערכת.',
  management:'שלום! אני העוזר החכם 🤖 אפשר לשאול אותי על נתוני הפעילות של הספרייה.',
};

const SUGGESTIONS = {
  student:  ['אילו ספרים יש בטכנולוגיה?', 'מתי אני צריך להחזיר ספרים?', 'האם יש לי חוב?'],
  librarian:['מי מאחר בהחזרה?', 'כמה השאלות פעילות יש?', 'אילו ספרים פגומים?'],
  management:['מה מצב הספרייה החודש?', 'כמה איחורים יש?'],
};

const SCREEN_ROUTES = {
  'לוח בקרה': '/',
  'מעקב חי': '/monitor',
  'השאלת ספר': '/loan',
  'החזרת ספר': '/return',
  'ניהול מלאי': '/inventory',
  'תלמידים': '/students',
  'יומן התראות': '/notifications',
  'דוחות': '/reports',
  'הגדרות': '/settings',
  'חיפוש ספרים': '/search',
  'השריונים שלי': '/reservations',
  'היסטוריה': '/history',
};

const FAB_SIZE = 54;
const MARGIN = 12;
const PANEL_GAP = 10;
const POS_KEY = 'bjl_assistant_pos';
const DRAG_THRESHOLD = 5;
const MOBILE_QUERY = '(max-width: 620px)';
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

/**
 * The part of the page the user can actually see right now, in the same
 * coordinate space position:fixed uses. On phones this SHRINKS when the
 * on-screen keyboard opens (and its top shifts if the browser scrolled the
 * focused input into view), which is exactly what we need to keep the chat
 * header - and its close button - visible while typing.
 */
function visibleRect() {
  const vv = window.visualViewport;
  if (vv) return { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height };
  const d = document.documentElement;
  return { x: 0, y: 0, w: d.clientWidth, h: d.clientHeight };
}

function clampBox(x, y, boxW, boxH, r) {
  return {
    x: Math.min(Math.max(x, r.x + MARGIN), Math.max(r.x + MARGIN, r.x + r.w - boxW - MARGIN)),
    y: Math.min(Math.max(y, r.y + MARGIN), Math.max(r.y + MARGIN, r.y + r.h - boxH - MARGIN)),
  };
}
const clampFab = (p, r = visibleRect()) => clampBox(p.x, p.y, FAB_SIZE, FAB_SIZE, r);

function loadPos() {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return clampFab(saved);
  } catch { /* ignore corrupt storage */ }
  const r = visibleRect();
  return clampFab({ x: MARGIN, y: r.h - FAB_SIZE - MARGIN });
}

/**
 * Render assistant text:
 *   **bold**  -> <strong>, or a navigation link if it names a screen
 *   *text*    -> <em> (the model uses single stars for book titles)
 * Single stars only match when hugging non-space text, so "5 * 3" or a
 * "* bullet" stay as-is. The ** alternative is listed first so it wins.
 */
const MD_RE = /(\*\*[^*]+\*\*|\*(?:[^\s*][^*\n]*?[^\s*]|[^\s*])\*)/g;

function RichText({ text, onNavigate }) {
  const parts = [];
  String(text).split(MD_RE).forEach((chunk, i) => {
    if (!chunk) return;
    if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
      const inner = chunk.slice(2, -2);
      const route = SCREEN_ROUTES[inner.trim()];
      parts.push(route
        ? <button key={i} className="assistant-screen-link" onClick={() => onNavigate(route)}>{inner}</button>
        : <strong key={i}>{inner}</strong>);
    } else if (chunk.startsWith('*') && chunk.endsWith('*') && chunk.length > 2) {
      parts.push(<em key={i}>{chunk.slice(1, -1)}</em>);
    } else {
      parts.push(<span key={i}>{chunk}</span>);
    }
  });
  return <>{parts}</>;
}

/* Inline SVGs for the expand/collapse control - emoji glyphs for these
   aren't guaranteed to exist in every phone's font and showed as a box. */
const IconExpand = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);
const IconCollapse = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
);

export default function AssistantWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);   // mobile: fullscreen or small window
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(loadPos);
  const [dragging, setDragging] = useState(false);
  const [mobile, setMobile] = useState(isMobile);
  const [rect, setRect] = useState(visibleRect);
  const bodyRef = useRef(null);
  const fabRef = useRef(null);
  const inputRef = useRef(null);
  const dragState = useRef(null);
  const wasBusy = useRef(false);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: 'assistant', content: WELCOME[user.role] }]);
    }
  }, [open]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Re-focus the input once a reply lands (after React re-enables it).
  useEffect(() => {
    if (wasBusy.current && !busy && open) inputRef.current?.focus();
    wasBusy.current = busy;
  }, [busy, open]);

  // Follow the visible area: keyboard open/close, rotation, zoom, resize.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onMq = (e) => setMobile(e.matches);
    const update = () => {
      const r = visibleRect();
      setRect(r);
      setPos((p) => clampFab(p, r));
    };
    mq.addEventListener('change', onMq);
    window.addEventListener('resize', update);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);

  // Lock page scroll only behind the fullscreen sheet.
  useEffect(() => {
    if (mobile && open && expanded) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
    return undefined;
  }, [mobile, open, expanded]);

  function onPointerDown(e) {
    fabRef.current.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
    setDragging(true);
  }
  function onPointerMove(e) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragState.current.moved = true;
    if (dragState.current.moved) {
      setPos(clampFab({ x: dragState.current.origX + dx, y: dragState.current.origY + dy }, rect));
    }
  }
  function onPointerUp() {
    setDragging(false);
    const moved = dragState.current?.moved;
    dragState.current = null;
    if (moved) {
      setPos((p) => { localStorage.setItem(POS_KEY, JSON.stringify(p)); return p; });
    } else {
      setOpen((o) => !o);
    }
  }

  function goTo(route) {
    if (mobile) setOpen(false);
    navigate(route);
  }

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    try {
      const r = await api('/assistant/chat', {
        method: 'POST',
        body: { messages: next.filter((m, i) => !(i === 0 && m.role === 'assistant')) },
      });
      setMessages([...next, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  /* ---- Panel geometry ----
     Fullscreen (mobile, expanded): fill the VISIBLE rect exactly, so the
     header stays on screen even with the keyboard up.
     Small window (desktop, or mobile not expanded): anchor next to the
     button, then clamp the whole box into the visible rect. */
  const fullscreen = mobile && expanded;
  let panelStyle;
  if (fullscreen) {
    panelStyle = { left: rect.x, top: rect.y, width: rect.w, height: rect.h, right: 'auto', bottom: 'auto' };
  } else {
    const maxW = mobile ? 400 : 360;
    const maxH = mobile ? 460 : 480;
    const panelW = Math.min(maxW, rect.w - 2 * MARGIN);
    const panelH = Math.min(maxH, rect.h - 2 * MARGIN);
    const openLeft = pos.x < rect.x + rect.w / 2;
    const openUp = pos.y > rect.y + rect.h / 2;
    const rawX = openLeft ? pos.x : pos.x + FAB_SIZE - panelW;
    const rawY = openUp ? pos.y - panelH - PANEL_GAP : pos.y + FAB_SIZE + PANEL_GAP;
    const { x, y } = clampBox(rawX, rawY, panelW, panelH, rect);
    panelStyle = { left: x, top: y, width: panelW, height: panelH, right: 'auto', bottom: 'auto' };
  }

  return (
    <>
      {!(mobile && open) && (
        <button
          ref={fabRef}
          className={`assistant-fab ${dragging ? 'dragging' : ''}`}
          style={{ left: pos.x, top: pos.y }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="פתיחת העוזר החכם (ניתן לגרור למיקום אחר)"
        >
          🤖
        </button>
      )}

      {open && (
        <div
          className={`assistant-panel ${mobile ? 'mobile' : ''} ${fullscreen ? 'expanded' : ''}`}
          role="dialog"
          aria-label="העוזר החכם"
          style={panelStyle}
        >
          <header className="assistant-head">
            <span>🤖 העוזר החכם</span>
            <div className="assistant-head-actions">
              {mobile && (
                <button
                  className="assistant-head-btn"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? 'חזרה לחלון קטן' : 'מסך מלא'}
                  title={expanded ? 'חלון קטן' : 'מסך מלא'}
                >
                  {expanded ? <IconCollapse /> : <IconExpand />}
                </button>
              )}
              <button className="assistant-head-btn" onClick={() => setOpen(false)} aria-label="סגירת הצ'אט">✕</button>
            </div>
          </header>

          <div className="assistant-body" ref={bodyRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.role === 'assistant' ? <RichText text={m.content} onNavigate={goTo} /> : m.content}
              </div>
            ))}
            {busy && <div className="bubble assistant typing">מקליד…</div>}
            {messages.length <= 1 && !busy && (
              <div className="suggestions">
                {SUGGESTIONS[user.role].map((s) => (
                  <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>

          <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="שאלו אותי משהו…"
              disabled={busy}
            />
            <button className="btn-primary sm" disabled={busy || !input.trim()}>שליחה</button>
          </form>
        </div>
      )}
    </>
  );
}
