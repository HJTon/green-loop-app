import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, LogOut, User } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  showLogout?: boolean;
}

export function Header({ title, showBack = false, showLogout = false }: HeaderProps) {
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

  // Don't show back on route list (it's the main screen after login)
  const isRouteList = location.pathname === '/route';

  return (
    <header className="bg-green-primary text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-md">
      <div className="flex items-center gap-3">
        {showBack && !isRouteList && (
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
