import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import lookupRoutes from './routes/lookup.routes.js';
import loansRoutes from './routes/loans.routes.js';
import statsRoutes from './routes/stats.routes.js';
import booksRoutes from './routes/books.routes.js';
import reservationsRoutes, { startReservationSweeper } from './routes/reservations.routes.js';
import enrichRoutes from './routes/enrich.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import adminRoutes from './routes/admin.routes.js';
import assistantRoutes from './routes/assistant.routes.js';
import { startNotificationWorkers } from './services/notify.service.js';
import { pool } from './db.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/lookup', lookupRoutes);
app.use('/api/loans', loansRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/enrich', enrichRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/assistant', assistantRoutes);

// Health check (useful for cloud deployment probes)
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'error', detail: e.message });
  }
});

// Central error handler - never leak stack traces to clients
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'שגיאת מערכת - נסו שוב מאוחר יותר' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Beit Jan Smart Library API running on http://localhost:${PORT}`);
  startReservationSweeper(10); // auto-cancel expired reservations every 10 min
  startNotificationWorkers();   // send queue every 1 min, reminders hourly
});
