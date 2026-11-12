import { escapeTaskText as escape } from './task-content.js';
import { safeUrl } from './app-utils.js';

export function createTaskDetails({ document, onSave, onAdvanced, confirmDiscard }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'task-details';
  dialog.className = 'task-details';
  dialog.setAttribute('aria-labelledby', 'task-details-title');
  document.body.append(dialog);
  let current = null;
  let dirty = false;
  let saving = false;
  let opener = null;

  const options = (values, selected) => values.map(([value, label]) => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');
  const statusOptions = [['todo','To Do'],['progress','In Progress'],['review','In Review'],['blocked','Blocked'],['done','Done']];
  function fitText() {
    dialog.querySelectorAll('textarea').forEach((input) => {
      input.style.height = 'auto';
      input.style.height = `${Math.max(input.id === 'detail-brief' ? 280 : 90,input.scrollHeight + 2)}px`;
    });
  }
  function message(text) { dialog.querySelector('[data-detail-message]').textContent = text; }
  function updateSaveButton() {
    const button = dialog.querySelector('[type="submit"]');
    button.disabled = !dirty || saving;
    button.textContent = saving ? 'Saving...' : 'Save changes';
    dialog.querySelector('[data-detail-state]').textContent = saving ? 'Saving changes' : dirty ? 'Unsaved changes' : 'All changes saved';
  }
  function close(force = false) {
    if (!force && (saving || (dirty && !confirmDiscard()))) return false;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    const taskId = current?.task.id;
    current = null;
    dirty = false;
    const returnTo = opener?.isConnected ? opener : [...document.querySelectorAll('[data-open-task]')].find((button) => button.dataset.openTask === taskId);
    returnTo?.focus({ preventScroll: true });
    return true;
  }
  function render() {
    const { task, brands, owners, canEdit, canManage, updated } = current;
    const refs = (task.refs || '').split(',').map((value) => value.trim()).filter(Boolean)
      .map((value) => ({ value, url: safeUrl(value) })).filter(({ url }) => url !== '#');
    dialog.innerHTML = `<form class="task-details-form">
      <header class="task-details-header"><span class="task-details-eyebrow">Workspace / Task</span><button class="btn btn-ghost btn-icon" type="button" data-detail-close aria-label="Close task details">&times;</button></header>
      <div class="task-details-content">
        <div class="task-details-heading"><span class="task-details-eyebrow">${escape(task.type || 'Task')}</span><h2 id="task-details-title">Task details</h2></div>
        <label class="task-details-name-label" for="detail-name">Task name</label>
        <textarea id="detail-name" class="task-details-name" rows="2" required ${canEdit ? '' : 'readonly'}>${escape(task.name)}</textarea>
        <div class="task-details-properties">
          <label>Status<select id="detail-status" class="form-control" ${canManage ? '' : 'disabled'}>${options(statusOptions,task.status)}</select></label>
          <label>Priority<select id="detail-priority" class="form-control" ${canManage ? '' : 'disabled'}>${options([['High','High'],['Medium','Medium'],['Low','Low']],task.priority)}</select></label>
          <label>Due date<input id="detail-due" type="date" class="form-control" value="${escape(task.due || '')}" required ${canEdit ? '' : 'readonly'}></label>
          <div class="task-details-property"><span>Brands</span><p>${escape(brands)}</p></div>
          <div class="task-details-property"><span>Owners</span><p>${escape(owners)}</p></div>
          <div class="task-details-property"><span>Last updated</span><p>${escape(updated)}</p></div>
        </div>
        <section class="task-details-section"><div class="task-details-section-head"><h3>Brief &amp; objective</h3><span>${canEdit ? 'Plain text' : 'Read only'}</span></div>
          <label class="sr-only" for="detail-brief">Full task brief</label>
          <textarea id="detail-brief" class="task-details-brief" rows="12" placeholder="Describe the goal, audience, deliverables, and what good looks like." ${canEdit ? '' : 'readonly'}>${escape(task.brief || '')}</textarea>
          ${!task.brief && !canEdit ? '<p class="task-details-empty">No brief has been added yet.</p>' : ''}
        </section>
        <section class="task-details-section"><div class="task-details-section-head"><h3>References</h3><span>${refs.length} link${refs.length === 1 ? '' : 's'}</span></div>
          <div class="task-details-links">${refs.map(({value,url},i) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer"><span>Reference ${i+1}</span><span>${escape(value)}</span></a>`).join('') || '<p class="task-details-empty">No reference links added.</p>'}</div>
        </section>
      </div>
      <footer class="task-details-footer"><div><span data-detail-state></span><p data-detail-message role="status" aria-live="polite"></p></div><div class="task-details-footer-actions">${canEdit ? '<button class="btn btn-ghost" type="button" data-detail-advanced>More properties</button>' : ''}${canEdit || canManage ? '<button class="btn btn-primary" type="submit" disabled>Save changes</button>' : '<button class="btn btn-ghost" type="button" data-detail-close>Close</button>'}</div></footer>
    </form>`;
    if (canEdit || canManage) updateSaveButton();
    else dialog.querySelector('[data-detail-state]').textContent = 'View only';
    dialog.querySelectorAll('[data-detail-close]').forEach((button) => button.addEventListener('click', () => close()));
    dialog.querySelector('[data-detail-advanced]')?.addEventListener('click', () => {
      const id = current.task.id;
      if (close()) onAdvanced(id);
    });
    dialog.querySelector('form').addEventListener('input', () => {
      if (!canEdit && !canManage) return;
      dirty = true;
      message('');
      updateSaveButton();
      fitText();
    });
    fitText();
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!dirty || saving) return;
      const patch = {};
      const value = (id) => dialog.querySelector(id).value;
      if (canEdit) {
        const name = value('#detail-name').trim();
        const due = value('#detail-due');
        if (!name || !due) { message('Task name and due date are required.'); return; }
        if (task.start && due < task.start) { message('The due date must follow the start date.'); return; }
        if (name !== task.name) patch.name = name;
        if (value('#detail-brief') !== (task.brief || '')) patch.brief = value('#detail-brief');
        if (due !== task.due) patch.due_date = due;
      }
      if (canManage) {
        if (value('#detail-status') !== task.status) patch.status = value('#detail-status');
        if (value('#detail-priority') !== task.priority) patch.priority = value('#detail-priority');
      }
      if (!Object.keys(patch).length) { dirty = false; updateSaveButton(); return; }
      saving = true;
      dialog.querySelectorAll('input,textarea,select,button').forEach((input) => { input.disabled = true; });
      updateSaveButton();
      let result;
      try { result = await onSave(task,patch); }
      catch { result = { error: 'Unable to save right now. Your draft is still here; please try again.' }; }
      saving = false;
      if (!current) return;
      if (result?.task) { current = result; dirty = false; render(); }
      else {
        // Keep the entered values and original version for an explicit retry.
        dialog.querySelectorAll('input,textarea,button').forEach((input) => { input.disabled = false; });
        dialog.querySelectorAll('select').forEach((input) => { input.disabled = !canManage; });
        updateSaveButton();
        message(result?.error || 'The task changed or could not be saved. Keep this draft and retry, or reopen the task to load the latest version.');
      }
    });
  }
  function open(context, source = document.activeElement) {
    if (saving || (dirty && !confirmDiscard())) return;
    current = structuredClone(context);
    dirty = false;
    opener = source;
    render();
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open','');
    }
    dialog.querySelector('[data-detail-close]').focus({ preventScroll: true });
    fitText();
  }
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  document.defaultView?.addEventListener('resize', () => { if (dialog.open) fitText(); });
  return {
    open, close,
    reconcile(context) {
      if (!current) return;
      if (!context || context.task.id !== current.task.id) {
        if (dirty) { message('This task was removed. Copy your draft before closing.'); return; }
        close(true);
      } else if (!dirty && !saving) { current = structuredClone(context); render(); }
    },
    get taskId() { return current?.task.id; },
  };
}
