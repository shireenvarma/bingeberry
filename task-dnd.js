function clearRowState(container) {
  container.querySelectorAll('.task-row-drag-source,.task-row-drop-before,.task-row-drop-after').forEach((row) => {
    row.classList.remove('task-row-drag-source', 'task-row-drop-before', 'task-row-drop-after');
  });
}

function getDropPlacement(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + (rect.height / 2) ? 'after' : 'before';
}

export function attachTaskDragAndDrop(container, config) {
  if (!container) return;
  container.__taskDndConfig = config;
  container.querySelectorAll('[data-drag-handle]').forEach((handle) => {
    handle.draggable = Boolean(config?.enabled);
  });
  container.querySelectorAll('[data-task-id]').forEach((row) => {
    row.classList.toggle('task-row-draggable', Boolean(config?.enabled));
  });

  if (container.dataset.dragSortBound === 'true') return;
  container.dataset.dragSortBound = 'true';

  container.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('[data-drag-handle]');
    const currentConfig = container.__taskDndConfig;
    if (!handle || !currentConfig?.enabled) {
      event.preventDefault();
      return;
    }

    const row = handle.closest('[data-task-id]');
    if (!row) {
      event.preventDefault();
      return;
    }

    clearRowState(container);
    row.classList.add('task-row-drag-source');
    container.dataset.dragSourceId = row.dataset.taskId || '';
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', container.dataset.dragSourceId);
    }
  });

  container.addEventListener('dragover', (event) => {
    const currentConfig = container.__taskDndConfig;
    const sourceId = container.dataset.dragSourceId;
    if (!currentConfig?.enabled || !sourceId) return;

    const row = event.target.closest('[data-task-id]');
    if (!row || row.dataset.taskId === sourceId) return;

    event.preventDefault();
    clearRowState(container);
    const sourceRow = container.querySelector(`[data-task-id="${sourceId}"]`);
    if (sourceRow) sourceRow.classList.add('task-row-drag-source');

    const placement = getDropPlacement(row, event.clientY);
    row.classList.add(placement === 'after' ? 'task-row-drop-after' : 'task-row-drop-before');
    container.dataset.dragTargetId = row.dataset.taskId || '';
    container.dataset.dragPlacement = placement;
  });

  container.addEventListener('drop', async (event) => {
    const currentConfig = container.__taskDndConfig;
    const sourceId = container.dataset.dragSourceId;
    if (!currentConfig?.enabled || !sourceId) return;

    const row = event.target.closest('[data-task-id]');
    if (!row) return;
    event.preventDefault();

    const targetId = row.dataset.taskId || '';
    const placement = getDropPlacement(row, event.clientY);
    clearRowState(container);
    container.dataset.dragSourceId = '';
    container.dataset.dragTargetId = '';
    container.dataset.dragPlacement = '';

    if (!targetId || targetId === sourceId) return;
    await currentConfig.onMove(sourceId, targetId, placement, currentConfig.viewKey);
  });

  container.addEventListener('dragend', () => {
    clearRowState(container);
    container.dataset.dragSourceId = '';
    container.dataset.dragTargetId = '';
    container.dataset.dragPlacement = '';
  });
}
