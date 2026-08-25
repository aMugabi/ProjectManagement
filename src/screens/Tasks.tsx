import { useFilters } from '../lib/useFilters';
import { ListView } from './ListView';
import { BoardView } from './BoardView';

export function Tasks() {
  const { taskView } = useFilters();
  return taskView === 'board' ? <BoardView /> : <ListView />;
}
