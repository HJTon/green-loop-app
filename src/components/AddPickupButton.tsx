import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

interface AddPickupButtonProps {
  /**
   * `fab` — floating action button pinned to the bottom-right (used on the route list).
   * `inline` — a smaller, in-flow button for placing inside content or a bottom bar
   *            (used where a FAB would overlap an existing sticky action).
   */
  variant?: 'fab' | 'inline';
  className?: string;
}

/**
 * Shared "add an unscheduled (ad-hoc) pickup" button. Navigates to the add-pickup
 * flow. Callers decide *whether* to render it (e.g. only for today / not read-only);
 * this component only owns the look and the navigation.
 */
export function AddPickupButton({ variant = 'fab', className = '' }: AddPickupButtonProps) {
  const navigate = useNavigate();

  if (variant === 'inline') {
    return (
      <button
        onClick={() => navigate('/add-pickup')}
        aria-label="Add unscheduled pickup"
        className={`flex items-center justify-center gap-2 text-green-primary hover:text-green-dark font-medium text-sm py-2 transition-colors ${className}`}
      >
        <Plus size={18} />
        <span>Add unscheduled pickup</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => navigate('/add-pickup')}
      aria-label="Add unscheduled pickup"
      className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-green-primary hover:bg-green-dark text-white font-semibold pl-4 pr-5 py-3 rounded-full shadow-lg active:scale-95 transition-transform ${className}`}
    >
      <Plus size={20} />
      <span>Add pickup</span>
    </button>
  );
}
