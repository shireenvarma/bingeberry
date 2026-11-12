export function escapeTaskText(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function taskBriefContent(task) {
  const name = `<button type="button" class="task-open-button t-name" data-open-task="${escapeTaskText(task.id)}">${escapeTaskText(task.name)}</button>`;
  if (!task.brief) return name;
  return `<details class="task-brief"><summary>${name}<span class="task-brief-hint">Quick preview</span></summary><div class="task-brief-body">${escapeTaskText(task.brief)}</div></details>`;
}
