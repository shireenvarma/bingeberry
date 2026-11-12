// Build options with DOM APIs so user-provided names remain plain text.
export function renderTaskFilters(container, { filters, groups, onChange, onClear, resultCount }) {
  const document = container.ownerDocument;
  container.replaceChildren();
  groups.forEach(({ key, label, options }) => {
    const field = document.createElement('label');
    field.className = 'task-filter-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    const select = document.createElement('select');
    select.className = 'form-control task-filter-select';
    select.name = key;
    options.forEach(({ value, label: optionLabel }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = optionLabel;
      select.appendChild(option);
    });
    select.value = filters[key];
    select.classList.toggle('is-filtered', filters[key] !== 'All');
    select.addEventListener('change', () => onChange(key, select.value));
    field.append(caption, select);
    container.appendChild(field);
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-ghost btn-sm task-filter-clear';
  clear.textContent = 'Clear filters';
  clear.disabled = groups.every(({ key }) => filters[key] === 'All');
  clear.addEventListener('click', onClear);
  const count = document.createElement('span');
  count.className = 'task-filter-count';
  count.setAttribute('role', 'status');
  count.textContent = `${resultCount} task${resultCount === 1 ? '' : 's'}`;
  container.append(clear, count);
}
