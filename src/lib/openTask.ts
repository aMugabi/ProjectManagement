import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';

/** Opens a task's drawer, switching to its workspace first if it lives in another one. */
export function openTask(taskId: string, workspaceId?: string | null) {
  const ts = useTaskStore.getState();
  if (workspaceId && workspaceId !== ts.activeWorkspaceId && ts.workspaces.some((w) => w.id === workspaceId)) {
    ts.setActiveWorkspace(workspaceId);
  }
  useUiStore.getState().openDrawer(taskId);
}
