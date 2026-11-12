import { escapeTaskText as escape } from './task-content.js';

export const BOARD_STATUSES = [
  ['todo', 'To Do'], ['progress', 'In Progress'], ['review', 'In Review'],
  ['blocked', 'Blocked'], ['done', 'Completed'],
];

export function renderTaskBoard(container, config) {
  container.__clearBoardDrag?.();
  container.__boardConfig = config;
  const { tasks, canMove, brands, owners, dueLabel, isOverdue, isPending } = config;
  const scrollLeft = container.scrollLeft;
  const focusedId = container.contains(container.ownerDocument.activeElement)
    ? container.ownerDocument.activeElement.closest('[data-task-id]')?.dataset.taskId : null;
  container.innerHTML = BOARD_STATUSES.map(([status, label]) => {
    const cards = tasks.filter((task) => task.status === status);
    return `<section class="board-column board-${status}" data-board-status="${status}" aria-label="${label}">
      <header class="board-column-header"><h3>${label}</h3><span class="board-count">${cards.length}</span></header>
      <div class="board-card-list">${cards.map((task) => {
        const pending = isPending(task);
        const editable = canMove(task);
        return `<article class="board-card" data-task-id="${escape(task.id)}" aria-busy="${pending}">
          <div class="board-card-top"><span class="board-brand">${escape(brands(task))}</span>${editable ? `<button type="button" class="board-drag-handle" draggable="${!pending}" aria-label="Drag task ${escape(task.name)} to another status" title="Drag to another column" ${pending ? 'disabled' : ''}>&#8942;&#8942;</button>` : ''}</div>
          <button type="button" class="task-open-button board-card-title" data-open-task="${escape(task.id)}">${escape(task.name)}</button>
          <div class="board-card-meta"><span class="board-priority" data-priority="${escape(task.priority)}">${escape(task.priority)}</span><span class="board-due${isOverdue(task) ? ' board-overdue' : ''}">${escape(dueLabel(task))}</span></div>
          <p class="board-owners">${escape(owners(task))}</p>
          ${editable ? `<label class="board-move-label">Move to<select class="form-control board-move" aria-label="Move ${escape(task.name)} to status" ${pending ? 'disabled' : ''}>${BOARD_STATUSES.map(([value, text]) => `<option value="${value}"${value === status ? ' selected' : ''}>${text}</option>`).join('')}</select></label>` : '<span class="board-readonly">View only</span>'}
        </article>`;
      }).join('') || '<p class="board-empty">No tasks here</p>'}</div>
    </section>`;
  }).join('');
  container.scrollLeft = scrollLeft;
  if (focusedId) {
    const card = [...container.querySelectorAll('[data-task-id]')].find((item) => item.dataset.taskId === focusedId);
    const focusTarget = card?.querySelector('.board-move:not(:disabled), [data-open-task]') || container.ownerDocument.getElementById('task-view-board');
    focusTarget?.focus({ preventScroll: true });
  }
  if (container.dataset.boardBound) return;
  container.dataset.boardBound = 'true';
  let sourceId = null;
  const clearDrag = () => {
    sourceId = null;
    container.querySelectorAll('.board-drop-target,.board-drag-source').forEach((el) => el.classList.remove('board-drop-target', 'board-drag-source'));
  };
  container.__clearBoardDrag = clearDrag;
  async function move(id, status) {
    const current = container.__boardConfig;
    const task = current.tasks.find((item) => item.id === id);
    if (!task || !current.canMove(task) || current.isPending(task) || task.status === status || !BOARD_STATUSES.some(([value]) => value === status)) return;
    await current.onMove(id, status);
  }
  container.addEventListener('change', async (event) => {
    if (!event.target.matches('.board-move')) return;
    const select = event.target;
    const card = select.closest('[data-task-id]');
    const previous = container.__boardConfig.tasks.find((task) => task.id === card.dataset.taskId)?.status;
    const status = select.value;
    select.disabled = true;
    try { await move(card.dataset.taskId, status); }
    finally { if (select.isConnected) { select.value = previous; select.disabled = false; } }
  });
  container.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('.board-drag-handle');
    const card = handle?.closest('[data-task-id]');
    const current = container.__boardConfig;
    const task = current.tasks.find((item) => item.id === card?.dataset.taskId);
    if (!handle || !task || !current.canMove(task) || current.isPending(task)) { event.preventDefault(); return; }
    sourceId = task.id;
    card.classList.add('board-drag-source');
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', sourceId); }
  });
  container.addEventListener('dragover', (event) => {
    const column = event.target.closest('[data-board-status]');
    if (!sourceId || !column) return;
    event.preventDefault();
    container.querySelectorAll('.board-drop-target').forEach((el) => el.classList.remove('board-drop-target'));
    column.classList.add('board-drop-target');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = container.getBoundingClientRect();
    if (event.clientX < rect.left + 60) container.scrollLeft -= 20;
    else if (event.clientX > rect.right - 60) container.scrollLeft += 20;
  });
  container.addEventListener('drop', async (event) => {
    const column = event.target.closest('[data-board-status]');
    const id = sourceId;
    clearDrag();
    if (!id || !column) return;
    event.preventDefault();
    await move(id, column.dataset.boardStatus);
  });
  container.addEventListener('dragend', clearDrag);
}
