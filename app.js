import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { BINGEBERRY_CONFIG } from './supabase/config.js';

const CONFIG = BINGEBERRY_CONFIG || {};
const SUPABASE_READY = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const supabase = SUPABASE_READY
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const todayStr = TODAY.toISOString().split('T')[0];
let VIEW_DATE = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
const MONTH_KEY = () => `${VIEW_DATE.getFullYear()}-${VIEW_DATE.getMonth()}`;

const DOC_KEYS = {
  recurring: 'recurring_templates',
  goals: 'business_goals',
  checklistState: 'monthly_checklist_state',
  checklistDef: 'monthly_checklist_definition',
  settings: 'app_settings',
};

const DEFAULT_CHECKLIST_DEF = {
  BINGE: [
    { label: 'Monthly Strategy', day: 20 },
    { label: 'Content Grid', day: 5 },
    { label: 'Week 1 Stories', day: 6 },
    { label: 'Week 2 Stories', day: 13 },
    { label: 'Week 3 Stories', day: 20 },
    { label: 'Week 4 Stories', day: 27 },
    { label: 'Ads Setup & Launch', day: 8 },
    { label: 'Analytics Report', day: 28 },
  ],
  Kujaku: [
    { label: 'Monthly Strategy', day: 18 },
    { label: 'Content Grid', day: 6 },
    { label: 'Stories W1&W2', day: 8 },
    { label: 'Stories W3&W4', day: 22 },
    { label: 'Analytics Report', day: 28 },
  ],
  'Personal Brand': [
    { label: '4x LinkedIn posts', day: 30 },
    { label: '1 long-form piece', day: 25 },
    { label: 'Plan next month', day: 28 },
  ],
  'Agency Ops': [
    { label: 'Send all invoices', day: 1 },
    { label: 'Business goal check-in', day: 15 },
    { label: 'Finance review', day: 30 },
    { label: 'Follow up on leads', day: 10 },
  ],
};

const EMPTY_SETTINGS = { ejsService: '', ejsTemplate: '', ejsPubkey: '' };
const USER_COLORS = ['#c8f065', '#6eb5ff', '#b48fff', '#ff7f6e', '#5fce8a', '#ffb547', '#ff6eb4'];

let DB = {
  users: [],
  clients: [],
  tasks: [],
  recurring: [],
  goals: [],
  checklist: {},
  checklistDef: { ...DEFAULT_CHECKLIST_DEF },
  settings: { ...EMPTY_SETTINGS },
};

let CURRENT_USER = null;
let currentPage = 'dashboard';
let activeFilters = { client: 'All', type: 'All', status: 'All', assigned: 'All' };
let authMode = 'signin';
let goalMetricCount = 0;

function byId(id) {
  return document.getElementById(id);
}

function mdate(day) {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), day);
  return d.toISOString().split('T')[0];
}

function monthDate(day, base = VIEW_DATE) {
  const d = new Date(base.getFullYear(), base.getMonth(), day);
  return d.toISOString().split('T')[0];
}

function monthLabel(base = VIEW_DATE) {
  return base.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function isSameMonth(dateStr, base = VIEW_DATE) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth();
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtDateTime(s) {
  if (!s) return 'No recent updates';
  return new Date(s).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function daysFrom(s) {
  if (!s) return 999;
  const d = new Date(`${s}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - TODAY) / 86400000);
}

function randomColor() {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function showToast(msg, type = 'success') {
  const container = byId('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function setAuthMessage(msg = '', type = 'error') {
  const el = byId('auth-err');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('show', Boolean(msg));
  el.style.color = type === 'success' ? 'var(--green)' : 'var(--coral)';
  el.style.borderColor = type === 'success' ? 'rgba(95,206,138,0.25)' : 'rgba(255,127,110,0.25)';
  el.style.background = type === 'success' ? 'rgba(95,206,138,0.1)' : 'rgba(255,127,110,0.1)';
}

function getClient(id) {
  return DB.clients.find((c) => c.id === id) || { name: 'Unknown', color: '#888', type: '' };
}

function getUser(id) {
  return DB.users.find((u) => u.id === id) || { name: 'Unassigned', color: '#555' };
}

function getUserPermissions(user) {
  return { viewGoals: user?.role === 'admin', ...(user?.permissions || {}) };
}

function canViewGoals() {
  return Boolean(CURRENT_USER && getUserPermissions(CURRENT_USER).viewGoals);
}

function isAdmin() {
  return CURRENT_USER?.role === 'admin';
}

function canEdit() {
  return CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'manager');
}

function visibleClients() {
  if (!CURRENT_USER) return [];
  if (isAdmin()) return [...DB.clients];
  return DB.clients.filter((client) => CURRENT_USER.clients.includes(client.id));
}

function visibleTasks() {
  if (!CURRENT_USER) return [];
  if (CURRENT_USER.role === 'admin') return [...DB.tasks];
  if (CURRENT_USER.role === 'manager') {
    return DB.tasks.filter(
      (task) => task.assigned === CURRENT_USER.id || CURRENT_USER.clients.includes(task.client),
    );
  }
  return DB.tasks.filter((task) => task.assigned === CURRENT_USER.id);
}

function canManageTask(task) {
  if (!CURRENT_USER || !task) return false;
  return CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'manager' || task.assigned === CURRENT_USER.id;
}

function canEditTaskDetails() {
  return Boolean(CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'manager'));
}

function touchTask(task) {
  task.updatedAt = new Date().toISOString();
  task.updatedBy = CURRENT_USER ? CURRENT_USER.id : task.updatedBy || '';
}

function statusClass(s) {
  return { todo: 's-todo', progress: 's-progress', review: 's-review', done: 's-done', blocked: 's-blocked' }[s] || 's-todo';
}

function statusLabel(s) {
  return { todo: 'To Do', progress: 'In Progress', review: 'In Review', done: 'Done', blocked: 'Blocked' }[s] || s;
}

function statusCycle(s) {
  return { todo: 'progress', progress: 'review', review: 'done', done: 'todo', blocked: 'todo' }[s] || 'todo';
}

function typeClass(t) {
  return { Retainer: 'b-retainer', Adhoc: 'b-adhoc', Branding: 'b-branding', Personal: 'b-personal', Goals: 'b-goals' }[t] || 'b-adhoc';
}

function prioClass(p) {
  return p === 'High' ? 'p-high' : p === 'Medium' ? 'p-med' : 'p-low';
}

function priorityCycle(p) {
  return { High: 'Medium', Medium: 'Low', Low: 'High' }[p] || 'Medium';
}

function priorityChipClass(p) {
  return p === 'High' ? 'high' : p === 'Medium' ? 'medium' : 'low';
}

function formatMetricValue(metric, value) {
  return metric?.unit === 'currency' ? `₹${Number(value || 0).toLocaleString('en-IN')}` : String(value ?? 0);
}

function dueDateEl(ds) {
  const d = daysFrom(ds);
  let cls = 'due';
  if (d < 0) cls += ' overdue';
  else if (d <= 3) cls += ' soon';
  const warn = d < 0 ? ' ⚠' : '';
  return `<span class="${cls}">${fmtDate(ds)}${warn}</span>`;
}

function normalizeChecklistValue(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function syncRevenueGoal() {
  const current = DB.clients.reduce((sum, client) => sum + (parseFloat(client.fee) || 0), 0);
  const suggestedTarget = current > 0 ? Math.ceil(current / 50000) * 50000 : 100000;
  let goal = DB.goals.find((item) => item.autoType === 'monthlyRevenue');

  if (!goal) {
    goal = {
      id: 'g-revenue',
      title: 'Monthly Revenue',
      desc: 'Auto-calculated from active project values and monthly retainers.',
      color: '#5fce8a',
      autoType: 'monthlyRevenue',
      metrics: [{ label: 'Booked Revenue', current, target: suggestedTarget, unit: 'currency' }],
    };
    DB.goals.unshift(goal);
    return;
  }

  const existingTarget = parseFloat(goal.metrics?.[0]?.target) || 0;
  goal.title = 'Monthly Revenue';
  goal.desc = 'Auto-calculated from active project values and monthly retainers.';
  goal.color = goal.color || '#5fce8a';
  goal.metrics = [{ label: 'Booked Revenue', current, target: Math.max(existingTarget, suggestedTarget), unit: 'currency' }];
}

function mapTaskFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    brief: row.brief || '',
    client: row.client_id,
    type: row.type,
    due: row.due_date,
    priority: row.priority,
    status: row.status,
    assigned: row.assigned_user_id || '',
    refs: row.refs || '',
    remind: row.remind || 'none',
    recurring: row.recurring ? 'yes' : 'no',
    recurringTemplateId: row.recurring_template_id || '',
    updatedAt: row.updated_at || new Date().toISOString(),
    updatedBy: row.updated_by || row.assigned_user_id || '',
  };
}

function mapTaskToRow(task) {
  return {
    id: task.id,
    name: task.name,
    brief: task.brief,
    client_id: task.client,
    type: task.type,
    due_date: task.due,
    priority: task.priority,
    status: task.status,
    assigned_user_id: task.assigned || null,
    refs: task.refs || '',
    remind: task.remind || 'none',
    recurring: task.recurring === 'yes',
    recurring_template_id: task.recurringTemplateId || null,
    updated_by: task.updatedBy || CURRENT_USER?.id || null,
  };
}

async function upsertWorkspaceDoc(key, value) {
  const { error } = await supabase.from('workspace_documents').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

async function persistRecurring() {
  await upsertWorkspaceDoc(DOC_KEYS.recurring, DB.recurring);
}

async function persistGoals() {
  const userGoals = DB.goals.filter((goal) => !goal.autoType);
  await upsertWorkspaceDoc(DOC_KEYS.goals, userGoals);
}

async function persistChecklist() {
  await upsertWorkspaceDoc(DOC_KEYS.checklistState, DB.checklist);
}

async function persistSettings() {
  await upsertWorkspaceDoc(DOC_KEYS.settings, DB.settings);
}

async function ensureProfile(authUser) {
  const username = (authUser.user_metadata?.username || authUser.email?.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  const baseProfile = {
    id: authUser.id,
    email: authUser.email,
    full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'New User',
    username,
    color: authUser.user_metadata?.color || randomColor(),
    calendar_url: '',
    email_reminders: true,
    permissions: { viewGoals: false },
  };

  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,full_name,username,color,calendar_url,email_reminders,permissions,role')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { error: insertError } = await supabase.from('profiles').insert(baseProfile);
    if (insertError) throw insertError;
    return;
  }

  const patch = {};
  if (data.email !== authUser.email) patch.email = authUser.email;
  if (!data.full_name && baseProfile.full_name) patch.full_name = baseProfile.full_name;
  if (!data.username && baseProfile.username) patch.username = baseProfile.username;
  if (!data.color) patch.color = baseProfile.color;

  if (Object.keys(patch).length) {
    const { error: updateError } = await supabase.from('profiles').update(patch).eq('id', authUser.id);
    if (updateError) throw updateError;
  }
}

async function loadWorkspace() {
  const [profilesRes, assignmentsRes, clientsRes, tasksRes, docsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,email,full_name,username,role,color,calendar_url,email_reminders,permissions,created_at')
      .order('created_at', { ascending: true }),
    supabase.from('client_assignments').select('user_id,client_id'),
    supabase.from('clients').select('*').order('name', { ascending: true }),
    supabase.from('tasks').select('*').order('due_date', { ascending: true }),
    supabase.from('workspace_documents').select('key,value'),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (docsRes.error) throw docsRes.error;

  const assignmentMap = new Map();
  for (const assignment of assignmentsRes.data || []) {
    if (!assignmentMap.has(assignment.user_id)) assignmentMap.set(assignment.user_id, []);
    assignmentMap.get(assignment.user_id).push(assignment.client_id);
  }

  DB.users = (profilesRes.data || []).map((profile) => ({
    id: profile.id,
    name: profile.full_name || 'Unnamed User',
    username: profile.username || '',
    role: profile.role || 'team',
    email: profile.email || '',
    color: profile.color || '#6eb5ff',
    clients: assignmentMap.get(profile.id) || [],
    calendarUrl: profile.calendar_url || '',
    emailReminders: profile.email_reminders !== false,
    permissions: profile.permissions || { viewGoals: profile.role === 'admin' },
  }));

  DB.clients = (clientsRes.data || []).map((client) => ({
    id: client.id,
    name: client.name,
    type: client.type,
    industry: client.industry || '',
    color: client.color || '#6eb5ff',
    brief: client.brief || '',
    stratDay: client.strat_day || 20,
    drive: client.drive || '',
    contact: client.contact || '',
    email: client.email || '',
    fee: client.fee || 0,
  }));

  DB.tasks = (tasksRes.data || []).map(mapTaskFromRow);

  const docs = Object.fromEntries((docsRes.data || []).map((doc) => [doc.key, doc.value]));
  DB.recurring = Array.isArray(docs[DOC_KEYS.recurring]) ? docs[DOC_KEYS.recurring] : [];
  DB.goals = Array.isArray(docs[DOC_KEYS.goals]) ? docs[DOC_KEYS.goals] : [];
  DB.checklist = normalizeChecklistValue(docs[DOC_KEYS.checklistState], {});
  DB.checklistDef = normalizeChecklistValue(docs[DOC_KEYS.checklistDef], DEFAULT_CHECKLIST_DEF);
  DB.settings = normalizeChecklistValue(docs[DOC_KEYS.settings], EMPTY_SETTINGS);

  syncRevenueGoal();
  CURRENT_USER = DB.users.find((user) => user.id === CURRENT_USER?.id) || CURRENT_USER;
}

async function hydrateFromSession(authUser) {
  try {
    await ensureProfile(authUser);
    CURRENT_USER = { id: authUser.id };
    await loadWorkspace();
    CURRENT_USER = DB.users.find((user) => user.id === authUser.id) || null;
    if (!CURRENT_USER) {
      throw new Error('Profile is missing after authentication.');
    }
    showApp();
    initApp();
    await checkRecurringGeneration();
  } catch (error) {
    console.error(error);
    setAuthMessage(error.message || 'Unable to load your workspace.');
    await supabase.auth.signOut();
  }
}

function showApp() {
  byId('auth-screen').style.display = 'none';
  byId('app').classList.add('active');
}

function showAuthScreen() {
  CURRENT_USER = null;
  byId('app').classList.remove('active');
  byId('auth-screen').style.display = 'flex';
  byId('auth-pass').value = '';
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  byId('auth-signup-fields').style.display = signup ? 'block' : 'none';
  byId('auth-pass-confirm-wrap').style.display = signup ? 'block' : 'none';
  byId('auth-submit-btn').textContent = signup ? 'Create Account →' : 'Sign In →';
  byId('auth-toggle-btn').textContent = signup ? 'Back to sign in' : 'Create an account';
  byId('auth-helper-text').textContent = signup
    ? 'New team members can create their own account here. The first signup becomes admin.'
    : 'Use your work email and password. Sessions stay active across refreshes.';
  setAuthMessage('');
}

async function doLogin() {
  if (!SUPABASE_READY) {
    setAuthMessage('Create supabase/config.js with your Supabase URL and anon key first.');
    return;
  }

  const email = byId('auth-user').value.trim().toLowerCase();
  const password = byId('auth-pass').value;
  if (!email || !password) {
    setAuthMessage('Email and password are required.');
    return;
  }

  if (authMode === 'signup') {
    const name = byId('auth-name').value.trim();
    const username = byId('auth-username').value.trim().toLowerCase();
    const confirm = byId('auth-pass-confirm').value;

    if (!name || !username) {
      setAuthMessage('Full name and username are required.');
      return;
    }
    if (password.length < 8) {
      setAuthMessage('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setAuthMessage('Password confirmation does not match.');
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          username,
          color: randomColor(),
        },
      },
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    if (!data.session) {
      setAuthMessage('Account created. Check your email to confirm the signup before logging in.', 'success');
      setAuthMode('signin');
      return;
    }

    setAuthMessage('Account created. Loading your workspace…', 'success');
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthMessage(error.message);
    return;
  }
  setAuthMessage('');
}

async function doLogout() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

async function refreshWorkspaceFromUI() {
  try {
    await loadWorkspace();
    renderAll();
    showToast('Workspace refreshed', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to refresh workspace', 'error');
  }
}

function updateMonthDisplay() {
  const monthTitle = `This Month · ${monthLabel(VIEW_DATE)}`;
  const checklistTitle = `Monthly Checklist · ${monthLabel(VIEW_DATE)}`;
  if (byId('month-page-title')) byId('month-page-title').textContent = monthTitle;
  if (byId('monthly-checklist-title')) byId('monthly-checklist-title').textContent = checklistTitle;
  if (byId('topbar-month-label')) byId('topbar-month-label').textContent = monthLabel(VIEW_DATE);
}

function changeMonth(delta) {
  VIEW_DATE = new Date(VIEW_DATE.getFullYear(), VIEW_DATE.getMonth() + delta, 1);
  updateMonthDisplay();
  if (currentPage === 'month') renderMonth();
  if (currentPage === 'monthly') renderMonthly();
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  tasks: 'Tasks',
  week: 'This Week',
  month: 'This Month',
  monthly: 'Monthly Checklist',
  goals: 'Business Goals',
  calendar: 'Calendar',
  clients: 'Clients & Projects',
  team: 'Team Members',
  recurring: 'Recurring Templates',
  settings: 'Settings',
  mywork: 'My Work',
};

function showPage(page) {
  document.querySelectorAll('.page').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));

  if (page === 'goals' && !canViewGoals()) page = isAdmin() ? 'dashboard' : 'mywork';
  if (page === 'dashboard' && CURRENT_USER?.role === 'team') page = 'mywork';

  currentPage = page;
  const el = byId(`page-${page}`);
  if (el) el.classList.add('active');
  byId('topbar-title').textContent = PAGE_TITLES[page] || 'Dashboard';

  const pageNav = [...document.querySelectorAll('.nav-item')].find((item) => item.onclick?.toString().includes(`showPage('${page}')`));
  if (pageNav) pageNav.classList.add('active');

  renderAll();
}

function buildNavClientList() {
  const cont = byId('nav-client-list');
  if (!cont) return;
  cont.innerHTML = '';
  visibleClients().forEach((client) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.innerHTML = `<span class="nav-dot" style="background:${client.color}"></span>${client.name}<span class="nav-count" id="nc-${client.id}">0</span>`;
    btn.onclick = () => {
      showPage('tasks');
      setFilter('client', client.id);
    };
    cont.appendChild(btn);
  });
}

function setFilter(key, val) {
  activeFilters = { client: 'All', type: 'All', status: 'All', assigned: 'All' };
  activeFilters[key] = val;
  byId('tasks-page-title').textContent =
    activeFilters.client !== 'All'
      ? `${getClient(activeFilters.client).name} Tasks`
      : activeFilters.type !== 'All'
        ? `${activeFilters.type} Tasks`
        : activeFilters.assigned !== 'All'
          ? `${getUser(activeFilters.assigned).name} Tasks`
          : val === 'overdue'
            ? 'Overdue'
            : 'All Tasks';
  renderTasksPage();
  renderFilterBar();
}

function appendFilterLabel(container, text) {
  const label = document.createElement('span');
  label.style.fontSize = '11px';
  label.style.color = 'var(--muted)';
  label.style.fontFamily = "'DM Mono',monospace";
  label.textContent = text;
  container.appendChild(label);
}

function appendFilterSeparator(container) {
  const sep = document.createElement('div');
  sep.className = 'f-sep';
  container.appendChild(sep);
}

function renderFilterBar() {
  const bar = byId('filter-bar');
  if (!bar) return;
  const clients = [{ id: 'All', name: 'All Clients' }, ...visibleClients()];
  const types = ['All', 'Retainer', 'Adhoc', 'Branding', 'Personal', 'Goals'];
  const assignees = ['All', ...DB.users.map((user) => user.id)];

  bar.innerHTML = '';
  appendFilterLabel(bar, 'CLIENT:');
  clients.forEach((client) => {
    const ch = document.createElement('button');
    ch.className = `f-chip${activeFilters.client === client.id ? ' active' : ''}`;
    ch.type = 'button';
    ch.textContent = client.name;
    ch.onclick = () => {
      activeFilters = { client: client.id, type: 'All', status: 'All', assigned: 'All' };
      renderTasksPage();
      renderFilterBar();
    };
    bar.appendChild(ch);
  });

  appendFilterSeparator(bar);
  appendFilterLabel(bar, 'TYPE:');
  types.forEach((type) => {
    const ch = document.createElement('button');
    ch.className = `f-chip${activeFilters.type === type ? ' active' : ''}`;
    ch.type = 'button';
    ch.textContent = type === 'All' ? 'All Types' : type;
    ch.onclick = () => {
      activeFilters = { client: 'All', type, status: 'All', assigned: 'All' };
      renderTasksPage();
      renderFilterBar();
    };
    bar.appendChild(ch);
  });

  if (isAdmin() || CURRENT_USER?.role === 'manager') {
    appendFilterSeparator(bar);
    appendFilterLabel(bar, 'OWNER:');
    assignees.forEach((uid) => {
      const ch = document.createElement('button');
      ch.className = `f-chip${activeFilters.assigned === uid ? ' active' : ''}`;
      ch.type = 'button';
      ch.textContent = uid === 'All' ? 'Everyone' : getUser(uid).name;
      ch.onclick = () => {
        activeFilters = { client: 'All', type: 'All', status: 'All', assigned: uid };
        renderTasksPage();
        renderFilterBar();
      };
      bar.appendChild(ch);
    });
  }
}

function taskRow(task, cols = 'full', editable = true) {
  const isDone = task.status === 'done';
  const client = getClient(task.client);
  const user = getUser(task.assigned);
  const canManage = editable && canManageTask(task);
  const canEditDetails = editable && canEditTaskDetails(task);
  const editBtn = canEditDetails ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="editTask('${task.id}')" title="Edit">✏️</button>` : '';
  const delBtn = editable && canEditTaskDetails(task) ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteTask('${task.id}')" title="Delete">×</button>` : '';
  const refsHtml = task.refs
    ? task.refs
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean)
        .map((ref) => `<a href="${ref}" target="_blank" rel="noreferrer" class="brief-link" style="font-size:10px;">🔗</a>`)
        .join('')
    : '';
  const statusAction = canManage ? `onclick="cycleStatus('${task.id}')"` : '';
  const statusReadonly = canManage ? '' : ' readonly';
  const priorityEl =
    cols === 'team'
      ? ''
      : canManage
        ? `<button class="priority-chip ${priorityChipClass(task.priority)}" onclick="cyclePriority('${task.id}')"><span class="prio ${prioClass(task.priority)}"></span>${task.priority}</button>`
        : `<span class="priority-chip ${priorityChipClass(task.priority)}" disabled><span class="prio ${prioClass(task.priority)}"></span>${task.priority}</span>`;

  if (cols === 'team') {
    return `<tr class="${isDone ? 'is-done' : ''}" id="tr-${task.id}">
      <td><input type="checkbox" class="ck" ${isDone ? 'checked' : ''} onchange="toggleDone('${task.id}')"></td>
      <td><div class="t-name">${task.name}</div>${task.brief ? `<div class="t-notes">${task.brief.substring(0, 60)}${task.brief.length > 60 ? '…' : ''}</div>` : ''}</td>
      <td><span style="font-size:11px;color:${client.color}">${client.name}</span></td>
      <td><span class="badge ${typeClass(task.type)}">${task.type}</span></td>
      <td>${dueDateEl(task.due)}</td>
      <td><span class="status ${statusClass(task.status)}${statusReadonly}" ${statusAction}>${statusLabel(task.status)}</span></td>
    </tr>`;
  }

  return `<tr class="${isDone ? 'is-done' : ''}" id="tr-${task.id}">
    <td><input type="checkbox" class="ck" ${isDone ? 'checked' : ''} onchange="toggleDone('${task.id}')"></td>
    <td><div class="t-name">${task.name}${refsHtml}</div>${task.brief ? `<div class="t-notes">${task.brief.substring(0, 60)}${task.brief.length > 60 ? '…' : ''}</div>` : ''}</td>
    <td><span style="font-size:12px;color:${client.color};font-weight:600">${client.name}</span></td>
    <td><span class="badge ${typeClass(task.type)}">${task.type}</span></td>
    <td><div style="display:flex;align-items:center;gap:6px"><div class="avatar" style="width:22px;height:22px;font-size:9px;background:${user.color}22;color:${user.color}">${user.name.charAt(0)}</div><span style="font-size:12px;color:var(--muted)">${user.name}</span></div></td>
    <td>${dueDateEl(task.due)}</td>
    <td>${priorityEl}</td>
    <td><span class="status ${statusClass(task.status)}${statusReadonly}" ${statusAction}>${statusLabel(task.status)}</span></td>
    <td style="white-space:nowrap">${editBtn}${delBtn}</td>
  </tr>`;
}

function fillTable(bodyId, tasks, cols = 'full') {
  const body = byId(bodyId);
  if (!body) return;
  const colspan = cols === 'team' ? 6 : 9;
  body.innerHTML = tasks.length ? tasks.map((task) => taskRow(task, cols)).join('') : `<tr class="empty-row"><td colspan="${colspan}">No tasks here</td></tr>`;
}

function updateBadges() {
  const active = visibleTasks().filter((task) => task.status !== 'done');
  const overdue = active.filter((task) => daysFrom(task.due) < 0);
  byId('nc-all').textContent = active.length;
  const overdueBadge = byId('nc-overdue');
  overdueBadge.textContent = overdue.length;
  overdueBadge.style.display = overdue.length ? '' : 'none';
  visibleClients().forEach((client) => {
    const el = byId(`nc-${client.id}`);
    if (el) {
      el.textContent = visibleTasks().filter((task) => task.status !== 'done' && task.client === client.id).length;
    }
  });
}

function renderDashboard() {
  const scopedTasks = visibleTasks();
  const active = scopedTasks.filter((task) => task.status !== 'done');
  const overdue = active.filter((task) => daysFrom(task.due) < 0).sort((a, b) => new Date(a.due) - new Date(b.due));
  const week = active.filter((task) => {
    const d = daysFrom(task.due);
    return d >= 0 && d <= 7;
  }).sort((a, b) => new Date(a.due) - new Date(b.due));
  const all = [...active].sort((a, b) => new Date(a.due) - new Date(b.due));
  const done = scopedTasks.filter((task) => task.status === 'done');
  const pct = scopedTasks.length ? Math.round((done.length / scopedTasks.length) * 100) : 0;

  byId('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-val" style="color:var(--coral)">${overdue.length}</div><div class="stat-sub">need attention now</div></div>
    <div class="stat-card"><div class="stat-label">Due This Week</div><div class="stat-val" style="color:var(--amber)">${week.length}</div><div class="stat-sub">coming up</div></div>
    <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-val" style="color:var(--green)">${done.length}</div><div class="stat-sub">out of ${scopedTasks.length}</div></div>
    <div class="stat-card"><div class="stat-label">Month Progress</div><div class="stat-val">${pct}%</div><div class="stat-bar"><div class="stat-fill" style="width:${pct}%;background:var(--lime)"></div></div></div>`;

  const banners = byId('reminder-banners');
  if (overdue.length) {
    banners.innerHTML = `<div class="reminder-banner"><span class="rb-icon">⚠️</span><div class="rb-text"><strong>${overdue.length} task${overdue.length > 1 ? 's' : ''} overdue</strong> — ${overdue.map((task) => task.name).slice(0, 3).join(', ')}${overdue.length > 3 ? '…' : ''}</div><button class="btn btn-ghost btn-sm" onclick="showPage('tasks');setFilter('status','overdue')">View All</button></div>`;
  } else {
    banners.innerHTML = '';
  }

  fillTable('dash-overdue', overdue);
  fillTable('dash-week', week);
  fillTable('dash-all', all);
  renderTeamUpdates();
}

function renderTasksPage() {
  let tasks = visibleTasks();
  if (activeFilters.client !== 'All') tasks = tasks.filter((task) => task.client === activeFilters.client);
  if (activeFilters.type !== 'All') tasks = tasks.filter((task) => task.type === activeFilters.type);
  if (activeFilters.status === 'overdue') tasks = tasks.filter((task) => task.status !== 'done' && daysFrom(task.due) < 0);
  if (activeFilters.assigned !== 'All') tasks = tasks.filter((task) => task.assigned === activeFilters.assigned);
  tasks = tasks.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (b.status === 'done' && a.status !== 'done') return -1;
    return new Date(a.due) - new Date(b.due);
  });
  fillTable('main-task-body', tasks);
}

function renderWeek() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const start = new Date(TODAY);
  start.setDate(TODAY.getDate() - TODAY.getDay());
  const scopedTasks = visibleTasks();
  let html = '';
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const isToday = ds === todayStr;
    const dayTasks = scopedTasks.filter((task) => task.due === ds && task.status !== 'done');
    html += `<div class="day-col"><div class="day-head ${isToday ? 'is-today' : ''}"><div class="day-name">${days[d.getDay()]}</div><div class="day-num">${d.getDate()}</div></div>
    ${dayTasks.map((task) => `<div class="day-task"><div class="dt-name">${task.name}</div><div class="dt-client">${getClient(task.client).name}</div></div>`).join('') || '<div style="padding:14px;text-align:center;color:var(--border2);font-size:20px">·</div>'}
    </div>`;
  }
  byId('week-grid').innerHTML = html;
  const weekTasks = scopedTasks.filter((task) => {
    const d = daysFrom(task.due);
    return d >= 0 && d <= 7;
  }).sort((a, b) => new Date(a.due) - new Date(b.due));
  fillTable('week-task-body', weekTasks);
}

function renderMonth() {
  updateMonthDisplay();
  const monthTasks = visibleTasks().filter((task) => isSameMonth(task.due, VIEW_DATE)).sort((a, b) => new Date(a.due) - new Date(b.due));
  fillTable('month-task-body', monthTasks);
}

function renderMonthly() {
  updateMonthDisplay();
  let html = '';
  for (const [group, items] of Object.entries(DB.checklistDef)) {
    let done = 0;
    const rows = items.map((item, index) => {
      const key = `${MONTH_KEY()}__${group}__${index}`;
      const checked = DB.checklist[key] || false;
      if (checked) done += 1;
      return `<div class="cl-item ${checked ? 'checked' : ''}" id="cli-${group}-${index}">
        <input type="checkbox" class="ck" ${checked ? 'checked' : ''} onchange="toggleChecklist('${group}',${index})">
        <div class="ci-text"><div class="ci-title">${item.label}</div><div class="ci-meta">Due ${item.day}${['st', 'nd', 'rd'][item.day - 1] || 'th'} · ${fmtDate(monthDate(item.day))}</div></div>
      </div>`;
    }).join('');
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    html += `<div class="cl-card"><div class="cl-head"><span style="width:8px;height:8px;border-radius:50%;background:var(--lime);display:inline-block"></span><span class="cl-head-title">${group}</span><span class="cl-progress-text">${done}/${items.length}</span></div><div class="cl-progress-bar"><div class="cl-progress-fill" style="width:${pct}%;background:var(--lime)"></div></div>${rows}</div>`;
  }
  byId('checklist-grid').innerHTML = html;
}

async function toggleChecklist(group, idx) {
  const key = `${MONTH_KEY()}__${group}__${idx}`;
  DB.checklist[key] = !DB.checklist[key];
  try {
    await persistChecklist();
    renderMonthly();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to update checklist', 'error');
  }
}

function renderGoals() {
  byId('goals-grid').innerHTML = DB.goals.map((goal) => {
    const editBtn = isAdmin() && !goal.autoType ? `<button class="goal-edit-btn" onclick="editGoal('${goal.id}')">✏️</button>` : '';
    const delBtn = isAdmin() && !goal.autoType ? `<button class="goal-edit-btn" style="right:44px" onclick="deleteGoal('${goal.id}')">×</button>` : '';
    const metrics = (goal.metrics || []).map((metric, idx) => {
      const pct = metric.target > 0 ? Math.min(100, Math.round((metric.current / metric.target) * 100)) : 0;
      const controls = isAdmin() && !goal.autoType
        ? `<div style="display:flex;gap:6px;margin-left:10px"><button class="btn btn-ghost btn-sm btn-icon" onclick="adjustGoalMetric('${goal.id}',${idx},-1)">−</button><button class="btn btn-ghost btn-sm btn-icon" onclick="adjustGoalMetric('${goal.id}',${idx},1)">+</button></div>`
        : '';
      return `<div class="goal-metric"><span class="gm-label">${metric.label}</span><div class="gm-bar"><div class="gm-fill" style="width:${pct}%;background:${goal.color}"></div></div><span class="gm-pct">${pct}%</span>${controls}</div><div class="month-task-meta" style="margin:-2px 0 10px 100px">${formatMetricValue(metric, metric.current)} / ${formatMetricValue(metric, metric.target)}</div>`;
    }).join('');
    return `<div class="goal-card">${editBtn}${delBtn}<div class="goal-title">${goal.title}</div><div class="goal-desc">${goal.desc}</div>${metrics}</div>`;
  }).join('');
}

async function saveCalUrl() {
  if (!CURRENT_USER) return;
  const calendarUrl = byId('cal-url-input').value.trim();
  const { error } = await supabase.from('profiles').update({ calendar_url: calendarUrl }).eq('id', CURRENT_USER.id);
  if (error) {
    showToast(error.message, 'error');
    return;
  }
  CURRENT_USER.calendarUrl = calendarUrl;
  const user = DB.users.find((entry) => entry.id === CURRENT_USER.id);
  if (user) user.calendarUrl = calendarUrl;
  renderCalendar();
  showToast('Calendar URL saved', 'success');
}

function renderCalendar() {
  const url = CURRENT_USER?.calendarUrl || '';
  const wrap = byId('cal-wrap');
  if (CURRENT_USER) byId('cal-url-input').value = CURRENT_USER.calendarUrl || '';
  if (url) {
    const src = url.includes('?') ? `${url}&bgcolor=%230a0a0b` : `${url}?bgcolor=%230a0a0b`;
    wrap.innerHTML = `<iframe class="cal-frame" src="${src}" style="height:600px;width:100%;border:none"></iframe>`;
    return;
  }
  wrap.innerHTML = `<div class="cal-head"><span style="font-size:13px;color:var(--muted)">📅 Google Calendar will appear here once you add your embed URL above.</span></div>`;
}

function renderClients() {
  const clients = isAdmin() ? DB.clients : visibleClients();
  byId('clients-grid').innerHTML = clients.map((client) => {
    const taskCount = visibleTasks().filter((task) => task.client === client.id && task.status !== 'done').length;
    const editBtn = canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editClient('${client.id}')">Edit</button>` : '';
    const delBtn = isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteClient('${client.id}')">×</button>` : '';
    return `<div class="client-card">
      <div class="client-card-head" onclick="showPage('tasks');setFilter('client','${client.id}')" style="cursor:pointer">
        <div class="client-color-bar" style="background:${client.color}"></div>
        <div class="client-info"><div class="client-name">${client.name}</div><div class="client-type-badge">${client.type} · ${client.industry || '—'}</div></div>
        <div class="client-card-actions">${editBtn}${delBtn}</div>
      </div>
      <div class="client-card-body">
        ${client.brief ? `<div class="client-detail-row"><span class="client-detail-label">Brief</span><span class="client-detail-val" style="font-size:12px;color:var(--muted)">${client.brief.substring(0, 80)}${client.brief.length > 80 ? '…' : ''}</span></div>` : ''}
        <div class="client-detail-row"><span class="client-detail-label">Strategy due</span><span class="client-detail-val">Day ${client.stratDay || '—'} of month</span></div>
        ${client.fee ? `<div class="client-detail-row"><span class="client-detail-label">Retainer</span><span class="client-detail-val">₹${Number(client.fee).toLocaleString('en-IN')}/mo</span></div>` : ''}
        ${client.contact ? `<div class="client-detail-row"><span class="client-detail-label">Contact</span><span class="client-detail-val">${client.contact}</span></div>` : ''}
        ${client.drive ? `<div class="client-detail-row"><span class="client-detail-label">Drive</span><span class="client-detail-val"><a href="${client.drive}" target="_blank" rel="noreferrer" class="brief-link">Open folder 🔗</a></span></div>` : ''}
        <div class="client-detail-row"><span class="client-detail-label">Open tasks</span><span class="client-detail-val" style="color:var(--lime)">${taskCount}</span></div>
      </div>
    </div>`;
  }).join('');
}

function renderTeam() {
  byId('users-grid').innerHTML = DB.users.map((user) => {
    const assigned = user.clients.map((clientId) => {
      const client = getClient(clientId);
      return `<span class="user-client-tag">${client.name}</span>`;
    }).join('');
    const editBtn = isAdmin() ? `<button class="btn btn-ghost btn-sm" onclick="editUser('${user.id}')" style="margin-top:10px">Edit</button>` : '';
    return `<div class="user-card">
      <div class="user-avatar-lg" style="background:${user.color}22;color:${user.color}">${user.name.charAt(0).toUpperCase()}</div>
      <div class="user-name-lg">${user.name}</div>
      <div class="user-email">${user.email || 'No email set'}</div>
      <span class="role-badge ${user.role}">${user.role}</span>
      <div style="font-size:11px;color:var(--muted);margin-top:10px">Goals access: ${getUserPermissions(user).viewGoals ? 'Yes' : 'No'} · Email reminders: ${user.emailReminders !== false ? 'On' : 'Off'}</div>
      ${user.clients.length ? `<div class="user-clients-label" style="margin-top:10px">Clients</div><div>${assigned}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap">${editBtn}</div>
    </div>`;
  }).join('');
}

function renderRecurring() {
  byId('recurring-list').innerHTML = DB.recurring.map((item) => {
    const client = getClient(item.client);
    const user = getUser(item.assigned);
    const delBtn = isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="deleteRecurring('${item.id}')">× Remove</button>` : '';
    return `<div class="template-card">
      <div class="template-head" onclick="this.classList.toggle('expanded');this.nextElementSibling.classList.toggle('open')">
        <span style="width:8px;height:8px;border-radius:50%;background:${client.color};display:inline-block"></span>
        <span style="font-weight:600;font-size:13px">${item.name}</span>
        <span class="badge ${typeClass(item.type)}" style="margin-left:8px">${item.type}</span>
        <span style="font-size:12px;color:var(--muted);margin-left:8px">→ ${client.name} · Due day ${item.day}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--muted)">Assigned: ${user.name}</span>
        <span class="expand-icon">▾</span>
      </div>
      <div class="template-body">
        <div style="padding:12px 16px;display:flex;align-items:center;gap:12px;border-top:1px solid var(--border)">
          <span style="font-size:12px;color:var(--muted)">Priority: <strong>${item.priority}</strong></span>
          ${item.brief ? `<span style="font-size:12px;color:var(--muted)">Brief: ${item.brief}</span>` : ''}
          ${delBtn}
        </div>
      </div>
    </div>`;
  }).join('') || '<div style="text-align:center;color:var(--muted);padding:32px">No recurring templates yet</div>';
}

function renderSettings() {
  byId('ejs-service').value = DB.settings.ejsService || '';
  byId('ejs-template').value = DB.settings.ejsTemplate || '';
  byId('ejs-pubkey').value = DB.settings.ejsPubkey || '';
  if (CURRENT_USER) {
    byId('account-email').textContent = CURRENT_USER.email || '—';
    byId('account-username').textContent = CURRENT_USER.username || '—';
    byId('account-role').textContent = CURRENT_USER.role || 'team';
  }
  byId('security-note').textContent = isAdmin()
    ? 'Admins can view team accounts and assign work, but raw passwords are never exposed.'
    : 'Passwords are stored by Supabase Auth and are never visible inside the dashboard.';

  const adminOnlyBlocks = document.querySelectorAll('[data-admin-only="true"]');
  adminOnlyBlocks.forEach((block) => {
    block.style.display = isAdmin() ? '' : 'none';
  });
}

function renderMyWork() {
  const myTasks = DB.tasks.filter((task) => task.assigned === CURRENT_USER.id && task.status !== 'done').sort((a, b) => new Date(a.due) - new Date(b.due));
  fillTable('mywork-body', myTasks, 'team');

  const myClients = CURRENT_USER.clients.map((clientId) => DB.clients.find((client) => client.id === clientId)).filter(Boolean);
  byId('brief-grid').innerHTML = myClients.map((client) => `
    <div class="brief-card">
      <div class="brief-head">
        <span class="brief-client-dot" style="background:${client.color}"></span>
        <span class="brief-client-name">${client.name}</span>
        <span class="brief-type">${client.type}</span>
      </div>
      <div class="brief-body">
        ${client.brief ? `<div class="brief-section"><div class="brief-section-label">Objective</div><div class="brief-section-text">${client.brief}</div></div>` : ''}
        ${client.drive ? `<div class="brief-section"><div class="brief-section-label">References</div><a href="${client.drive}" target="_blank" rel="noreferrer" class="brief-link">Open Drive Folder 🔗</a></div>` : ''}
        <div class="brief-section"><div class="brief-section-label">Strategy due</div><div class="brief-section-text">Day ${client.stratDay} of every month</div></div>
      </div>
    </div>`).join('') || '<div style="color:var(--muted);font-size:13px">No clients assigned to you yet.</div>';
}

function renderTeamUpdates() {
  const block = byId('team-updates-block');
  const grid = byId('team-updates-grid');
  if (!block || !grid) return;
  if (!isAdmin()) {
    block.style.display = 'none';
    return;
  }

  block.style.display = '';
  const teamUsers = DB.users.filter((user) => user.role !== 'admin');
  grid.innerHTML = teamUsers.map((user) => {
    const tasks = DB.tasks.filter((task) => task.assigned === user.id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const open = tasks.filter((task) => task.status !== 'done').length;
    const review = tasks.filter((task) => task.status === 'review').length;
    const done = tasks.filter((task) => task.status === 'done').length;
    const updates = tasks.slice(0, 3).map((task) => `<div class="team-update-item"><div class="team-update-item-title">${task.name}</div><div class="team-update-item-meta">${statusLabel(task.status)} · ${fmtDateTime(task.updatedAt)} · ${getClient(task.client).name}</div></div>`).join('') || '<div class="team-update-item"><div class="team-update-item-title">No task updates yet</div></div>';
    return `<div class="team-update-card">
      <div class="team-update-head">
        <div class="avatar" style="background:${user.color}22;color:${user.color}">${user.name.charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight:600">${user.name}</div>
          <div class="month-task-meta">Latest progress across assigned tasks</div>
        </div>
      </div>
      <div class="team-update-stats">
        <div class="mini-stat"><strong>${open}</strong><span>Open</span></div>
        <div class="mini-stat"><strong>${review}</strong><span>Review</span></div>
        <div class="mini-stat"><strong>${done}</strong><span>Done</span></div>
      </div>
      <div class="team-update-list">${updates}</div>
      <button class="btn btn-ghost btn-sm" onclick="showPage('tasks');setFilter('assigned','${user.id}')">Open ${user.name}'s Tasks</button>
    </div>`;
  }).join('');
}

function renderAll() {
  updateBadges();
  renderFilterBar();
  if (currentPage === 'dashboard') renderDashboard();
  if (currentPage === 'tasks') renderTasksPage();
  if (currentPage === 'week') renderWeek();
  if (currentPage === 'month') renderMonth();
  if (currentPage === 'monthly') renderMonthly();
  if (currentPage === 'goals' && canViewGoals()) renderGoals();
  if (currentPage === 'calendar') renderCalendar();
  if (currentPage === 'clients') renderClients();
  if (currentPage === 'team') renderTeam();
  if (currentPage === 'recurring') renderRecurring();
  if (currentPage === 'settings') renderSettings();
  if (currentPage === 'mywork') renderMyWork();
}

function populateTaskModal() {
  const clientSelect = byId('t-client');
  const assigneeSelect = byId('t-assigned');
  const clients = isAdmin() || CURRENT_USER?.role === 'manager' ? DB.clients : visibleClients();
  clientSelect.innerHTML = clients.map((client) => `<option value="${client.id}">${client.name}</option>`).join('');
  assigneeSelect.innerHTML = `<option value="">Unassigned</option>${DB.users.map((user) => `<option value="${user.id}">${user.name}</option>`).join('')}`;
  if (clients[0] && !clientSelect.value) clientSelect.value = clients[0].id;
  if (!canEditTaskDetails()) {
    assigneeSelect.value = CURRENT_USER.id;
    assigneeSelect.disabled = true;
  } else {
    assigneeSelect.disabled = false;
  }
}

function openModal(id) {
  byId(id).classList.add('open');
}

function closeModal(id) {
  byId(id).classList.remove('open');
}

function openTaskModal() {
  if (!canEditTaskDetails()) {
    showToast('Only admins and managers can create or fully edit tasks.', 'error');
    return;
  }
  populateTaskModal();
  byId('edit-task-id').value = '';
  byId('task-modal-title').textContent = 'Add Task';
  byId('t-name').value = '';
  byId('t-brief').value = '';
  byId('t-due').value = todayStr;
  byId('t-type').value = 'Retainer';
  byId('t-priority').value = 'Medium';
  byId('t-status').value = 'todo';
  byId('t-refs').value = '';
  byId('t-remind').value = 'none';
  byId('t-recurring').value = 'no';
  byId('t-assigned').value = '';
  openModal('task-modal');
}

function editTask(id) {
  if (!canEditTaskDetails()) {
    showToast('Only admins and managers can edit task details.', 'error');
    return;
  }
  const task = DB.tasks.find((entry) => entry.id === id);
  if (!task) return;
  populateTaskModal();
  byId('edit-task-id').value = id;
  byId('task-modal-title').textContent = 'Edit Task';
  byId('t-name').value = task.name;
  byId('t-brief').value = task.brief || '';
  byId('t-client').value = task.client;
  byId('t-type').value = task.type;
  byId('t-due').value = task.due;
  byId('t-priority').value = task.priority;
  byId('t-status').value = task.status;
  byId('t-assigned').value = task.assigned || '';
  byId('t-refs').value = task.refs || '';
  byId('t-remind').value = task.remind || 'none';
  byId('t-recurring').value = task.recurring || 'no';
  openModal('task-modal');
}

function syncRecurringTemplateFromTask(task) {
  if (task.recurring !== 'yes') return task.recurringTemplateId || '';
  const dueDate = new Date(`${task.due}T00:00:00`);
  const day = Math.min(dueDate.getDate(), 28);
  const existingId = task.recurringTemplateId || newId('r');
  const template = {
    id: existingId,
    name: task.name,
    client: task.client,
    type: task.type,
    day,
    priority: task.priority,
    assigned: task.assigned,
    brief: task.brief,
  };
  const idx = DB.recurring.findIndex((item) => item.id === existingId);
  if (idx >= 0) DB.recurring[idx] = template;
  else DB.recurring.push(template);
  return existingId;
}

async function saveTask() {
  if (!canEditTaskDetails()) {
    showToast('Only admins and managers can save task details.', 'error');
    return;
  }
  const name = byId('t-name').value.trim();
  if (!name) {
    showToast('Task name is required', 'error');
    return;
  }

  const id = byId('edit-task-id').value || crypto.randomUUID();
  const task = {
    id,
    name,
    brief: byId('t-brief').value.trim(),
    client: byId('t-client').value,
    type: byId('t-type').value,
    due: byId('t-due').value,
    priority: byId('t-priority').value,
    status: byId('t-status').value,
    assigned: byId('t-assigned').value,
    refs: byId('t-refs').value.trim(),
    remind: byId('t-remind').value,
    recurring: byId('t-recurring').value,
    recurringTemplateId: '',
    updatedAt: new Date().toISOString(),
    updatedBy: CURRENT_USER?.id || '',
  };
  task.recurringTemplateId = syncRecurringTemplateFromTask(task);

  try {
    const { error } = await supabase.from('tasks').upsert(mapTaskToRow(task));
    if (error) throw error;
    await persistRecurring();
    await loadWorkspace();
    closeModal('task-modal');
    renderAll();
    showToast(byId('edit-task-id').value ? 'Task updated' : 'Task added', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to save task', 'error');
  }
}

async function deleteTask(id) {
  if (!canEditTaskDetails()) {
    showToast('Only admins and managers can delete tasks.', 'error');
    return;
  }
  if (!confirm('Delete this task?')) return;
  try {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
    await loadWorkspace();
    renderAll();
    showToast('Task deleted', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to delete task', 'error');
  }
}

async function updateTaskField(task, patch, successMessage = '') {
  try {
    const nextTask = { ...task, ...patch };
    touchTask(nextTask);
    const { error } = await supabase.from('tasks').update(mapTaskToRow(nextTask)).eq('id', task.id);
    if (error) throw error;
    await loadWorkspace();
    renderAll();
    if (successMessage) showToast(successMessage, 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to update task', 'error');
  }
}

async function toggleDone(id) {
  const task = DB.tasks.find((entry) => entry.id === id);
  if (!task || !canManageTask(task)) return;
  await updateTaskField(task, { status: task.status === 'done' ? 'todo' : 'done' });
}

async function cycleStatus(id) {
  const task = DB.tasks.find((entry) => entry.id === id);
  if (!task || !canManageTask(task)) return;
  await updateTaskField(task, { status: statusCycle(task.status) });
}

async function cyclePriority(id) {
  const task = DB.tasks.find((entry) => entry.id === id);
  if (!task || !canManageTask(task)) return;
  await updateTaskField(task, { priority: priorityCycle(task.priority) });
}

function openClientModal() {
  if (!canEdit()) {
    showToast('Only admins and managers can manage clients.', 'error');
    return;
  }
  byId('edit-client-id').value = '';
  byId('client-modal-title').textContent = 'Add Client / Project';
  ['c-name', 'c-industry', 'c-brief', 'c-drive', 'c-contact', 'c-email'].forEach((id) => {
    byId(id).value = '';
  });
  byId('c-type').value = 'Retainer';
  byId('c-color').value = '#6eb5ff';
  byId('c-strat-day').value = '20';
  byId('c-fee').value = '';
  openModal('client-modal');
}

function editClient(id) {
  if (!canEdit()) {
    showToast('Only admins and managers can manage clients.', 'error');
    return;
  }
  const client = DB.clients.find((entry) => entry.id === id);
  if (!client) return;
  byId('edit-client-id').value = id;
  byId('client-modal-title').textContent = 'Edit Client';
  byId('c-name').value = client.name;
  byId('c-type').value = client.type;
  byId('c-industry').value = client.industry || '';
  byId('c-color').value = client.color || '#6eb5ff';
  byId('c-brief').value = client.brief || '';
  byId('c-strat-day').value = client.stratDay || 20;
  byId('c-drive').value = client.drive || '';
  byId('c-contact').value = client.contact || '';
  byId('c-email').value = client.email || '';
  byId('c-fee').value = client.fee || '';
  openModal('client-modal');
}

async function saveClient() {
  if (!canEdit()) {
    showToast('Only admins and managers can manage clients.', 'error');
    return;
  }
  const name = byId('c-name').value.trim();
  if (!name) {
    showToast('Client name required', 'error');
    return;
  }
  const id = byId('edit-client-id').value || crypto.randomUUID();
  const client = {
    id,
    name,
    type: byId('c-type').value,
    industry: byId('c-industry').value.trim(),
    color: byId('c-color').value,
    brief: byId('c-brief').value.trim(),
    strat_day: parseInt(byId('c-strat-day').value, 10) || 20,
    drive: byId('c-drive').value.trim(),
    contact: byId('c-contact').value.trim(),
    email: byId('c-email').value.trim(),
    fee: parseFloat(byId('c-fee').value || '0') || 0,
  };
  try {
    const { error } = await supabase.from('clients').upsert(client);
    if (error) throw error;
    await loadWorkspace();
    closeModal('client-modal');
    buildNavClientList();
    renderAll();
    showToast(byId('edit-client-id').value ? 'Client updated' : 'Client added', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to save client', 'error');
  }
}

async function deleteClient(id) {
  if (!isAdmin()) {
    showToast('Only admins can delete clients.', 'error');
    return;
  }
  if (!confirm('Delete this client? Tasks linked to it will also be removed.')) return;
  try {
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) throw error;
    await loadWorkspace();
    buildNavClientList();
    renderAll();
    showToast('Client removed', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to delete client', 'error');
  }
}

function openUserModal() {
  showToast('Team members create their own accounts from the sign-up screen.', 'error');
}

function editUser(id) {
  if (!isAdmin()) {
    showToast('Only admins can edit team members.', 'error');
    return;
  }
  const user = DB.users.find((entry) => entry.id === id);
  if (!user) return;
  byId('edit-user-id').value = user.id;
  byId('user-modal-title').textContent = 'Edit Team Member';
  byId('u-name').value = user.name;
  byId('u-username').value = user.username;
  byId('u-email').value = user.email || '';
  byId('u-role').value = user.role;
  byId('u-color').value = user.color || '#6eb5ff';
  byId('u-view-goals').checked = Boolean(getUserPermissions(user).viewGoals);
  byId('u-email-reminders').checked = user.emailReminders !== false;
  const checks = byId('u-clients-checkboxes');
  checks.innerHTML = DB.clients.map((client) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" value="${client.id}" class="ck" ${user.clients.includes(client.id) ? 'checked' : ''}> ${client.name}</label>`).join('');
  openModal('user-modal');
}

async function saveUser() {
  if (!isAdmin()) {
    showToast('Only admins can edit team members.', 'error');
    return;
  }
  const editId = byId('edit-user-id').value;
  if (!editId) {
    showToast('New users should sign up from the login screen.', 'error');
    return;
  }

  const name = byId('u-name').value.trim();
  const username = byId('u-username').value.trim().toLowerCase();
  const email = byId('u-email').value.trim().toLowerCase();
  if (!name || !username || !email) {
    showToast('Name, username, and email are required.', 'error');
    return;
  }
  const clientChecks = [...document.querySelectorAll('#u-clients-checkboxes input:checked')].map((el) => el.value);
  const role = byId('u-role').value;
  const permissions = { viewGoals: byId('u-view-goals').checked || role === 'admin' };

  try {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: name,
        username,
        email,
        role,
        color: byId('u-color').value,
        email_reminders: byId('u-email-reminders').checked,
        permissions,
      })
      .eq('id', editId);
    if (profileError) throw profileError;

    const { error: deleteError } = await supabase.from('client_assignments').delete().eq('user_id', editId);
    if (deleteError) throw deleteError;

    if (clientChecks.length) {
      const rows = clientChecks.map((clientId) => ({ user_id: editId, client_id: clientId }));
      const { error: insertError } = await supabase.from('client_assignments').insert(rows);
      if (insertError) throw insertError;
    }

    await loadWorkspace();
    if (CURRENT_USER?.id === editId) {
      CURRENT_USER = DB.users.find((user) => user.id === editId) || CURRENT_USER;
      initApp();
    } else {
      renderAll();
    }
    closeModal('user-modal');
    showToast('Team member updated', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to update team member', 'error');
  }
}

let goalMetricCounter = 0;

function addGoalMetricRow(label = '', current = 0, target = 100) {
  const div = document.createElement('div');
  div.className = 'form-row';
  div.id = `gm-row-${goalMetricCounter}`;
  div.innerHTML = `<div class="form-group"><label class="form-label">Metric Name</label><input class="form-control gm-label-input" placeholder="e.g. Revenue" value="${label}"></div><div class="form-group"><label class="form-label">Current / Target</label><div style="display:flex;gap:8px"><input class="form-control gm-current" type="number" placeholder="0" value="${current}" style="flex:1"><input class="form-control gm-target" type="number" placeholder="100" value="${target}" style="flex:1"><button class="btn btn-danger btn-sm btn-icon" onclick="document.getElementById('gm-row-${goalMetricCounter}').remove()">×</button></div></div>`;
  byId('goal-metrics-list').appendChild(div);
  goalMetricCounter += 1;
}

function openGoalModal() {
  if (!isAdmin()) {
    showToast('Only admins can manage goals.', 'error');
    return;
  }
  byId('edit-goal-id').value = '';
  byId('goal-modal-title').textContent = 'Add Goal';
  byId('g-title').value = '';
  byId('g-desc').value = '';
  byId('g-color').value = '#c8f065';
  byId('goal-metrics-list').innerHTML = '';
  goalMetricCounter = 0;
  addGoalMetricRow();
  openModal('goal-modal');
}

function editGoal(id) {
  if (!isAdmin()) {
    showToast('Only admins can manage goals.', 'error');
    return;
  }
  const goal = DB.goals.find((entry) => entry.id === id);
  if (!goal) return;
  byId('edit-goal-id').value = id;
  byId('goal-modal-title').textContent = 'Edit Goal';
  byId('g-title').value = goal.title;
  byId('g-desc').value = goal.desc;
  byId('g-color').value = goal.color;
  byId('goal-metrics-list').innerHTML = '';
  goalMetricCounter = 0;
  (goal.metrics || []).forEach((metric) => addGoalMetricRow(metric.label, metric.current, metric.target));
  openModal('goal-modal');
}

async function saveGoal() {
  if (!isAdmin()) {
    showToast('Only admins can manage goals.', 'error');
    return;
  }
  const title = byId('g-title').value.trim();
  if (!title) {
    showToast('Goal title required', 'error');
    return;
  }
  const metrics = [...document.querySelectorAll('#goal-metrics-list .form-row')].map((row) => ({
    label: row.querySelector('.gm-label-input').value.trim() || 'Metric',
    current: parseFloat(row.querySelector('.gm-current').value) || 0,
    target: parseFloat(row.querySelector('.gm-target').value) || 100,
  })).filter((metric) => metric.label);
  const id = byId('edit-goal-id').value;
  const goal = { id: id || newId('g'), title, desc: byId('g-desc').value.trim(), color: byId('g-color').value, metrics };
  const idx = DB.goals.findIndex((entry) => entry.id === id);
  if (idx >= 0) DB.goals[idx] = goal;
  else DB.goals.push(goal);
  try {
    await persistGoals();
    closeModal('goal-modal');
    renderGoals();
    showToast('Goal saved', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to save goal', 'error');
  }
}

async function adjustGoalMetric(goalId, metricIndex, delta) {
  const goal = DB.goals.find((entry) => entry.id === goalId);
  if (!goal || goal.autoType) return;
  const metric = goal.metrics?.[metricIndex];
  if (!metric) return;
  metric.current = Math.max(0, (parseFloat(metric.current) || 0) + delta);
  try {
    await persistGoals();
    renderGoals();
    showToast('Goal updated', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to update goal', 'error');
  }
}

async function deleteGoal(id) {
  if (!isAdmin()) {
    showToast('Only admins can manage goals.', 'error');
    return;
  }
  if (!confirm('Delete this goal?')) return;
  DB.goals = DB.goals.filter((goal) => goal.id !== id);
  try {
    await persistGoals();
    renderGoals();
    showToast('Goal deleted', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to delete goal', 'error');
  }
}

function openRecurringModal() {
  if (!canEdit()) {
    showToast('Only admins and managers can manage recurring templates.', 'error');
    return;
  }
  ['r-name', 'r-brief'].forEach((id) => {
    byId(id).value = '';
  });
  byId('r-day').value = 20;
  byId('r-priority').value = 'Medium';
  byId('r-type').value = 'Retainer';
  const clients = isAdmin() || CURRENT_USER?.role === 'manager' ? DB.clients : visibleClients();
  byId('r-client').innerHTML = clients.map((client) => `<option value="${client.id}">${client.name}</option>`).join('');
  byId('r-assigned').innerHTML = `<option value="">Unassigned</option>${DB.users.map((user) => `<option value="${user.id}">${user.name}</option>`).join('')}`;
  openModal('recurring-modal');
}

async function saveRecurring() {
  if (!canEdit()) {
    showToast('Only admins and managers can manage recurring templates.', 'error');
    return;
  }
  const name = byId('r-name').value.trim();
  if (!name) {
    showToast('Name required', 'error');
    return;
  }
  const template = {
    id: newId('r'),
    name,
    client: byId('r-client').value,
    type: byId('r-type').value,
    day: parseInt(byId('r-day').value, 10) || 20,
    priority: byId('r-priority').value,
    assigned: byId('r-assigned').value,
    brief: byId('r-brief').value.trim(),
  };
  DB.recurring.push(template);
  try {
    await persistRecurring();
    closeModal('recurring-modal');
    renderRecurring();
    showToast('Recurring template added', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to save template', 'error');
  }
}

async function deleteRecurring(id) {
  if (!canEdit()) {
    showToast('Only admins and managers can manage recurring templates.', 'error');
    return;
  }
  if (!confirm('Remove this template?')) return;
  DB.recurring = DB.recurring.filter((item) => item.id !== id);
  try {
    await persistRecurring();
    renderRecurring();
    showToast('Template removed', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to remove template', 'error');
  }
}

async function checkRecurringGeneration() {
  if (!DB.recurring.length || !canEdit()) return;
  const monthPrefix = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
  const inserts = [];

  DB.recurring.forEach((template) => {
    const due = mdate(Math.min(template.day, 28));
    const exists = DB.tasks.some((task) => task.recurringTemplateId === template.id && task.due.startsWith(monthPrefix));
    if (exists) return;
    inserts.push({
      id: crypto.randomUUID(),
      name: template.name,
      brief: template.brief || '',
      client_id: template.client,
      type: template.type,
      due_date: due,
      priority: template.priority,
      status: 'todo',
      assigned_user_id: template.assigned || null,
      refs: '',
      remind: '3',
      recurring: true,
      recurring_template_id: template.id,
      updated_by: CURRENT_USER?.id || null,
    });
  });

  if (!inserts.length) return;
  const { error } = await supabase.from('tasks').insert(inserts);
  if (error) {
    console.error(error);
    return;
  }
  await loadWorkspace();
  renderAll();
  showToast(`${inserts.length} recurring tasks generated for this month`, 'success');
}

async function saveEmailJS() {
  if (!isAdmin()) {
    showToast('Only admins can update workspace settings.', 'error');
    return;
  }
  DB.settings.ejsService = byId('ejs-service').value.trim();
  DB.settings.ejsTemplate = byId('ejs-template').value.trim();
  DB.settings.ejsPubkey = byId('ejs-pubkey').value.trim();
  try {
    await persistSettings();
    showToast('EmailJS config saved', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to save EmailJS settings', 'error');
  }
}

async function saveMyPassword() {
  const password = byId('new-password').value;
  const confirm = byId('confirm-password').value;
  if (!password || password.length < 8) {
    showToast('Use a password with at least 8 characters.', 'error');
    return;
  }
  if (password !== confirm) {
    showToast('Password confirmation does not match.', 'error');
    return;
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    showToast(error.message, 'error');
    return;
  }
  byId('new-password').value = '';
  byId('confirm-password').value = '';
  showToast('Password updated', 'success');
}

function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'binge-berry-backup.json';
  a.click();
}

async function resetData() {
  if (!isAdmin()) {
    showToast('Only admins can reset workspace data.', 'error');
    return;
  }
  if (!confirm('Reset workspace data? User accounts stay, but tasks, clients, docs, and assignments will be cleared.')) return;
  try {
    const { error: tasksError } = await supabase.from('tasks').delete().not('id', 'is', null);
    if (tasksError) throw tasksError;
    const { error: clientsError } = await supabase.from('clients').delete().not('id', 'is', null);
    if (clientsError) throw clientsError;
    const { error: assignmentsError } = await supabase.from('client_assignments').delete().not('user_id', 'is', null);
    if (assignmentsError) throw assignmentsError;
    const { error: docsError } = await supabase.from('workspace_documents').delete().in('key', Object.values(DOC_KEYS));
    if (docsError) throw docsError;
    await loadWorkspace();
    buildNavClientList();
    renderAll();
    showToast('Workspace data reset', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to reset data', 'error');
  }
}

function initApp() {
  const user = CURRENT_USER;
  byId('topbar-avatar').textContent = user.name.charAt(0).toUpperCase();
  byId('topbar-avatar').style.background = `${user.color}22`;
  byId('topbar-avatar').style.color = user.color;
  byId('topbar-name').textContent = user.name;

  const roleBadge = byId('topbar-role');
  roleBadge.textContent = user.role;
  roleBadge.className = `role-badge ${user.role}`;

  updateMonthDisplay();
  buildNavClientList();
  byId('nav-goals-item').style.display = canViewGoals() ? '' : 'none';

  document.querySelectorAll('[onclick="openTaskModal()"]').forEach((button) => {
    button.style.display = canEditTaskDetails() ? '' : 'none';
  });
  document.querySelectorAll('[onclick="openClientModal()"]').forEach((button) => {
    button.style.display = canEdit() ? '' : 'none';
  });
  document.querySelectorAll('[onclick="openRecurringModal()"]').forEach((button) => {
    button.style.display = canEdit() ? '' : 'none';
  });
  document.querySelectorAll('[onclick="openGoalModal()"]').forEach((button) => {
    button.style.display = isAdmin() ? '' : 'none';
  });

  showPage(user.role === 'team' ? 'mywork' : currentPage);
}

function bindBaseEvents() {
  byId('auth-user').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') byId('auth-pass').focus();
  });
  byId('auth-pass').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') doLogin();
  });
  document.querySelectorAll('.overlay').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (event.target === el) el.classList.remove('open');
    });
  });
  document.addEventListener('keydown', (event) => {
    if (!CURRENT_USER) return;
    if (event.key === 'Escape') document.querySelectorAll('.overlay.open').forEach((el) => el.classList.remove('open'));
    if ((event.metaKey || event.ctrlKey) && event.key === 'k' && canEditTaskDetails()) {
      event.preventDefault();
      openTaskModal();
    }
  });
}

async function bootstrap() {
  bindBaseEvents();
  setAuthMode('signin');

  if (!SUPABASE_READY) {
    byId('auth-submit-btn').disabled = true;
    byId('auth-toggle-btn').disabled = true;
    setAuthMessage('Create supabase/config.js with your Supabase URL and anon key to start.', 'error');
    return;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    setAuthMessage(sessionError.message);
    return;
  }

  if (sessionData.session?.user) {
    await hydrateFromSession(sessionData.session.user);
  } else {
    showAuthScreen();
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      await hydrateFromSession(session.user);
    } else {
      showAuthScreen();
    }
  });
}

Object.assign(window, {
  doLogin,
  doLogout,
  toggleAuthMode: () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'),
  changeMonth,
  showPage,
  setFilter,
  openTaskModal,
  editTask,
  saveTask,
  deleteTask,
  toggleDone,
  cycleStatus,
  cyclePriority,
  openClientModal,
  editClient,
  saveClient,
  deleteClient,
  openUserModal,
  editUser,
  saveUser,
  openGoalModal,
  addGoalMetricRow,
  editGoal,
  saveGoal,
  adjustGoalMetric,
  deleteGoal,
  openRecurringModal,
  saveRecurring,
  deleteRecurring,
  saveEmailJS,
  saveMyPassword,
  saveCalUrl,
  exportData,
  resetData,
  openModal,
  closeModal,
  toggleChecklist,
  refreshWorkspaceFromUI,
});

bootstrap();
