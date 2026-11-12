export function escapeTaskText(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function taskBriefContent(task) {
  const name = escapeTaskText(task.name);
  if (!task.brief) return `<div class="t-name">${name}</div>`;
  return `<details class="task-brief"><summary class="t-name">${name}<span class="task-brief-hint">View brief</span></summary><div class="task-brief-body">${escapeTaskText(task.brief)}</div></details>`;
}
