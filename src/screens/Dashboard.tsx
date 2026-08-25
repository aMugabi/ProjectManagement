import { useFilters } from '../lib/useFilters';
import { FocusLayout } from './FocusLayout';
import { PortfolioLayout } from './PortfolioLayout';

export function Dashboard() {
  const { dashLayout } = useFilters();
  return dashLayout === 'portfolio' ? <PortfolioLayout /> : <FocusLayout />;
}
