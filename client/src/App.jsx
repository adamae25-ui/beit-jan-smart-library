import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Loan from './pages/Loan.jsx';
import Return from './pages/Return.jsx';
import Search from './pages/Search.jsx';
import Reservations from './pages/Reservations.jsx';
import History from './pages/History.jsx';
import Inventory from './pages/Inventory.jsx';
import Notifications from './pages/Notifications.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Students from './pages/Students.jsx';
import LiveMonitor from './pages/LiveMonitor.jsx';
import Layout from './components/Layout.jsx';

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot-screen">טוען…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="loan" element={<Protected roles={['librarian']}><Loan /></Protected>} />
            <Route path="return" element={<Protected roles={['librarian']}><Return /></Protected>} />
            <Route path="inventory" element={<Protected roles={['librarian']}><Inventory /></Protected>} />
            <Route path="notifications" element={<Protected roles={['librarian']}><Notifications /></Protected>} />
            <Route path="settings" element={<Protected roles={['librarian']}><Settings /></Protected>} />
            <Route path="students" element={<Protected roles={['librarian']}><Students /></Protected>} />
            <Route path="monitor" element={<Protected roles={['librarian', 'management']}><LiveMonitor /></Protected>} />
            <Route path="reports" element={<Protected roles={['librarian', 'management']}><Reports /></Protected>} />
            <Route path="search" element={<Search />} />
            <Route path="reservations" element={<Protected roles={['student']}><Reservations /></Protected>} />
            <Route path="history" element={<Protected roles={['student']}><History /></Protected>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
