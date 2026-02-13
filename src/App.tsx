import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from '@/contexts/AppContext';
import { ToastContainer } from '@/components/Toast';
import { LoginPage } from '@/pages/LoginPage';
import { RouteListPage } from '@/pages/RouteListPage';
import { PickupPage } from '@/pages/PickupPage';
import { ConfirmationPage } from '@/pages/ConfirmationPage';
import { SummaryPage } from '@/pages/SummaryPage';
import { DropOffPage } from '@/pages/DropOffPage';
import { ConsolidationPage } from '@/pages/ConsolidationPage';

function AppRoutes() {
  const { toasts, dismissToast } = useApp();

  return (
    <>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/route" element={<RouteListPage />} />
        <Route path="/pickup/:clientId" element={<PickupPage />} />
        <Route path="/confirmation/:clientId" element={<ConfirmationPage />} />
        <Route path="/consolidation" element={<ConsolidationPage />} />
        <Route path="/dropoff" element={<DropOffPage />} />
        <Route path="/summary" element={<SummaryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
