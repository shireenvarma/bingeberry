export function escapeTaskText(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function taskBriefContent(task) {
  return `<button type="button" class="task-open-button t-name" data-open-task="${escapeTaskText(task.id)}">${escapeTaskText(task.name)}</button>`;
}
