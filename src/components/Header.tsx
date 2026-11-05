import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, LogOut, User, Settings } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  showLogout?: boolean;
  showSettings?: boolean;
}

export function Header({ title, showBack = false, showLogout = false, showSettings = false }: HeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { collector, logout } = useApp();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleBack = () => {
    navigate(-1);
  };

  // Don't show back on route list or load-van (they're top-level after login)
  const isTopLevel = location.pathname === '/route' || location.pathname === '/load-van';

  return (
    <header className="bg-green-primary text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-md">
      <div className="flex items-center gap-3">
        {showBack && !isTopLevel && (
          <button
            onClick={handleBack}
            className="p-1 -ml-1 hover:bg-green-dark rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
        )}
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        {collector && (
          <div className="flex items-center gap-2 text-sm">
            <User size={18} />
            <span>{collector.name}</span>
          </div>
        )}
        {showSettings && (
          <button
            onClick={() => navigate('/settings')}
            className="p-1 hover:bg-green-dark rounded-lg transition-colors"
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
        )}
        {showLogout && (
          <button
            onClick={handleLogout}
            className="p-1 hover:bg-green-dark rounded-lg transition-colors"
          >
            <LogOut size={20} />
          </button>
        )}
      </div>
    </header>
  );
}
