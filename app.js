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

const EMPTY_SETTINGS = {
  ejsService: '',
  ejsTemplate: '',
  ejsPubkey: '',
  focusPresets: { focusMinutes: 50, breakMinutes: 10 },
  focusSessions: {},
};
const USER_COLORS = ['#c8f065', '#6eb5ff', '#b48fff', '#ff7f6e', '#5fce8a', '#ffb547', '#ff6eb4'];
const DEFAULT_CLIENT_TYPES = ['Retainer', 'Project', 'Branding', 'Adhoc', 'Personal', 'Goals'];
const DEFAULT_REMINDER_TIME = '10:00';

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
let recoveringPassword = false;
let goalMetricCount = 0;
let recurringMetricCount = 0;
let taskReminderCount = 0;
let clientTimelineCount = 0;
let focusTimerState = { mode: 'focus', running: false, endsAt: 0, remainingMs: 50 * 60 * 1000, intervalId: null };

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

function dateInputValue(value, fallback = todayStr) {
  return value || fallback;
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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function clampDay(day) {
  return Math.max(1, Math.min(28, parseInt(day, 10) || 1));
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
  return DB.clients.find((c) => c.id === id) || { name: 'Unknown', color: '#888', type: '', category: '', guidelines: '' };
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
  if (isAdmin()) return [...DB.clients].sort((a, b) => a.sortOrder - b.sortOrder);
  return DB.clients.filter((client) => CURRENT_USER.clients.includes(client.id)).sort((a, b) => a.sortOrder - b.sortOrder);
}

function visibleTasks() {
  if (!CURRENT_USER) return [];
  if (CURRENT_USER.role === 'admin') return [...DB.tasks];
  if (CURRENT_USER.role === 'manager') {
    return DB.tasks.filter(
      (task) => taskAssignedTo(task, CURRENT_USER.id) || getClientIds(task).some((id) => CURRENT_USER.clients.includes(id)),
    );
  }
  return DB.tasks.filter((task) => taskAssignedTo(task, CURRENT_USER.id));
}

function canManageTask(task) {
  if (!CURRENT_USER || !task) return false;
  return CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'manager' || taskAssignedTo(task, CURRENT_USER.id);
}

function canEditTaskDetails() {
  return Boolean(CURRENT_USER && (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'manager'));
}

function canCreateTask() {
  return Boolean(CURRENT_USER);
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
  return { Retainer: 'b-retainer', Project: 'b-branding', Branding: 'b-branding', Adhoc: 'b-adhoc', Personal: 'b-personal', Goals: 'b-goals' }[t] || 'b-adhoc';
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

function normalizeIdList(values = []) {
  return unique(Array.isArray(values) ? values : []);
}

function normalizeReminderList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => {
      if (typeof entry === 'number') return { daysBefore: entry, time: DEFAULT_REMINDER_TIME };
      return {
        daysBefore: Math.max(0, parseInt(entry?.daysBefore, 10) || 0),
        time: String(entry?.time || DEFAULT_REMINDER_TIME).slice(0, 5),
      };
    })
    .filter((entry) => Number.isFinite(entry.daysBefore))
    .sort((a, b) => a.daysBefore - b.daysBefore || a.time.localeCompare(b.time));
}

function normalizeTimelineItem(item = {}) {
  return {
    id: item.id || newId('tl'),
    title: item.title || '',
    date: item.date || todayStr,
    brief: item.brief || '',
    assignedIds: normalizeIdList(item.assignedIds || item.assigned_user_ids || []),
  };
}

function getClientIds(task) {
  if (Array.isArray(task?.clientIds) && task.clientIds.length) return normalizeIdList(task.clientIds);
  return task?.client ? [task.client] : [];
}

function getAssignedIds(task) {
  if (Array.isArray(task?.assignedIds) && task.assignedIds.length) return normalizeIdList(task.assignedIds);
  return task?.assigned ? [task.assigned] : [];
}

function getReminderList(task) {
  if (Array.isArray(task?.reminders)) return normalizeReminderList(task.reminders);
  if (task?.remind && task.remind !== 'none') return normalizeReminderList([{ daysBefore: task.remind, time: DEFAULT_REMINDER_TIME }]);
  return [];
}

function taskMatchesClient(task, clientId) {
  return getClientIds(task).includes(clientId);
}

function taskAssignedTo(task, userId) {
  return getAssignedIds(task).includes(userId);
}

function getPrimaryClientId(task) {
  return getClientIds(task)[0] || '';
}

function getTaskClientNames(task) {
  const names = getClientIds(task).map((id) => getClient(id).name).filter(Boolean);
  return names.length ? names.join(', ') : 'No brand';
}

function getTaskAssigneeNames(task) {
  const names = getAssignedIds(task).map((id) => getUser(id).name).filter(Boolean);
  return names.length ? names.join(', ') : 'Unassigned';
}

function isProjectType(type, billingModel = '') {
  return billingModel === 'project' || ['Project', 'Branding', 'Adhoc'].includes(type);
}

function clientRevenueLabel(client, variant) {
  const project = isProjectType(client?.type, client?.billingModel);
  if (variant === 'paper') return project ? 'On-paper Project Value' : 'On-paper Monthly Revenue';
  return project ? 'Actual Received Value' : 'Actual Monthly Revenue';
}

function taskRepeatLabel(task) {
  return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[task.repeatType] || '';
}

function slotLabel(slot) {
  return { any: 'Anytime', first_half: 'First Half', second_half: 'Second Half' }[slot] || 'Anytime';
}

function categoryOptions() {
  return unique(DB.clients.map((client) => client.category).filter(Boolean));
}

function clientTypeOptions() {
  return unique([...DEFAULT_CLIENT_TYPES, ...DB.clients.map((client) => client.type).filter(Boolean), ...DB.tasks.map((task) => task.type).filter(Boolean)]);
}

function getDueDateForTemplate(template, baseDate = TODAY) {
  const anchor = new Date(`${template.anchorDate || template.due || todayStr}T00:00:00`);
  const repeatType = template.repeatType || 'monthly';
  if (repeatType === 'daily') return baseDate.toISOString().split('T')[0];
  if (repeatType === 'weekly') {
    const target = new Date(baseDate);
    const diff = anchor.getDay() - target.getDay();
    target.setDate(target.getDate() + diff);
    return target.toISOString().split('T')[0];
  }
  const targetDay = Math.min(anchor.getDate(), 28);
  return monthDate(targetDay, new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
}

function focusPrefsKey() {
  return `bingeberry-focus-prefs-${CURRENT_USER?.id || 'guest'}`;
}

function focusSessionsKey() {
  return `bingeberry-focus-sessions-${CURRENT_USER?.id || 'guest'}`;
}

function getFocusPrefs() {
  try {
    return { ...EMPTY_SETTINGS.focusPresets, ...JSON.parse(localStorage.getItem(focusPrefsKey()) || '{}') };
  } catch {
    return { ...EMPTY_SETTINGS.focusPresets };
  }
}

function setFocusPrefs(value) {
  localStorage.setItem(focusPrefsKey(), JSON.stringify(value));
}

function getFocusSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(focusSessionsKey()) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setFocusSessions(value) {
  localStorage.setItem(focusSessionsKey(), JSON.stringify(value));
}

function syncRevenueGoal() {
  const onPaper = DB.clients.reduce((sum, client) => sum + (parseFloat(client.paperFee) || parseFloat(client.fee) || 0), 0);
  const actual = DB.clients.reduce((sum, client) => sum + (parseFloat(client.actualFee) || parseFloat(client.fee) || 0), 0);
  const suggestedTarget = Math.max(onPaper, actual, 100000);
  let goal = DB.goals.find((item) => item.autoType === 'monthlyRevenue');

  if (!goal) {
    goal = {
      id: 'g-revenue',
      title: 'Monthly Revenue',
      desc: 'Auto-calculated from on-paper and actual client revenue.',
      color: '#5fce8a',
      autoType: 'monthlyRevenue',
      metrics: [
        { label: 'On Paper', current: onPaper, target: suggestedTarget, unit: 'currency' },
        { label: 'Actual', current: actual, target: suggestedTarget, unit: 'currency' },
      ],
    };
    DB.goals.unshift(goal);
    return;
  }

  const existingTarget = parseFloat(goal.metrics?.[0]?.target) || 0;
  goal.title = 'Monthly Revenue';
  goal.desc = 'Auto-calculated from on-paper and actual client revenue.';
  goal.color = goal.color || '#5fce8a';
  goal.metrics = [
    { label: 'On Paper', current: onPaper, target: Math.max(existingTarget, suggestedTarget), unit: 'currency' },
    { label: 'Actual', current: actual, target: Math.max(existingTarget, suggestedTarget), unit: 'currency' },
  ];
}

function mapTaskFromRow(row) {
  const clientIds = normalizeIdList(row.client_ids || (row.client_id ? [row.client_id] : []));
  const assignedIds = normalizeIdList(row.assigned_user_ids || (row.assigned_user_id ? [row.assigned_user_id] : []));
  return {
    id: row.id,
    name: row.name,
    brief: row.brief || '',
    client: clientIds[0] || row.client_id || '',
    clientIds,
    type: row.type,
    start: row.start_date || '',
    due: row.due_date,
    priority: row.priority,
    slot: row.slot || 'any',
    status: row.status,
    assigned: assignedIds[0] || row.assigned_user_id || '',
    assignedIds,
    refs: row.refs || '',
    remind: row.remind || 'none',
    reminders: normalizeReminderList(row.reminders),
    recurring: row.recurring ? 'yes' : 'no',
    repeatType: row.repeat_type || (row.recurring ? 'monthly' : 'none'),
    recurringTemplateId: row.recurring_template_id || '',
    cleanupAfterDays: row.cleanup_after_days || 14,
    sourceClientTimelineId: row.source_client_timeline_id || '',
    autoGenerated: Boolean(row.auto_generated),
    sortOrder: row.sort_order || 0,
    updatedAt: row.updated_at || new Date().toISOString(),
    updatedBy: row.updated_by || row.assigned_user_id || '',
  };
}

function mapTaskToRow(task) {
  const clientIds = getClientIds(task);
  const assignedIds = getAssignedIds(task);
  const reminders = getReminderList(task);
  return {
    id: task.id,
    name: task.name,
    brief: task.brief,
    client_id: clientIds[0] || null,
    client_ids: clientIds,
    type: task.type,
    start_date: task.start || null,
    due_date: task.due,
    priority: task.priority,
    slot: task.slot || 'any',
    status: task.status,
    assigned_user_id: assignedIds[0] || null,
    assigned_user_ids: assignedIds,
    refs: task.refs || '',
    remind: reminders[0] ? String(reminders[0].daysBefore) : 'none',
    reminders,
    recurring: task.repeatType && task.repeatType !== 'none',
    repeat_type: task.repeatType || 'none',
    recurring_template_id: task.recurringTemplateId || null,
    cleanup_after_days: task.cleanupAfterDays || 14,
    source_client_timeline_id: task.sourceClientTimelineId || null,
    auto_generated: Boolean(task.autoGenerated),
    sort_order: task.sortOrder || 0,
    updated_by: task.updatedBy || CURRENT_USER?.id || null,
  };
}

async function ensureSession() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) throw new Error('Your session expired. Refresh the page and sign in again.');
  return data.session;
}

async function upsertWorkspaceDoc(key, value) {
  await ensureSession();
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
  await ensureSession();
  const [profilesRes, assignmentsRes, clientsRes, tasksRes, docsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,email,full_name,username,role,color,calendar_url,email_reminders,permissions,created_at')
      .order('created_at', { ascending: true }),
    supabase.from('client_assignments').select('user_id,client_id'),
    supabase.from('clients').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    supabase.from('tasks').select('*').order('sort_order', { ascending: true }).order('due_date', { ascending: true }),
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
    billingModel: client.billing_model || 'retainer',
    industry: client.industry || '',
    category: client.category || '',
    color: client.color || '#6eb5ff',
    brief: client.brief || '',
    guidelines: client.guidelines || '',
    stratDay: client.strat_day || 20,
    drive: client.drive || '',
    contact: client.contact || '',
    email: client.email || '',
    fee: client.fee || 0,
    paperFee: client.paper_fee || client.fee || 0,
    actualFee: client.actual_fee || client.fee || 0,
    projectStartDate: client.project_start_date || '',
    projectEndDate: client.project_end_date || '',
    timeline: (Array.isArray(client.timeline) ? client.timeline : []).map(normalizeTimelineItem),
    sortOrder: client.sort_order || 0,
  })).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  DB.tasks = (tasksRes.data || []).map(mapTaskFromRow).sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.due) - new Date(b.due));

  const docs = Object.fromEntries((docsRes.data || []).map((doc) => [doc.key, doc.value]));
  DB.recurring = Array.isArray(docs[DOC_KEYS.recurring]) ? docs[DOC_KEYS.recurring].map((item) => ({
    ...item,
    clientIds: normalizeIdList(item.clientIds || (item.client ? [item.client] : [])),
    assignedIds: normalizeIdList(item.assignedIds || (item.assigned ? [item.assigned] : [])),
    reminders: normalizeReminderList(item.reminders || []),
    repeatType: item.repeatType || 'monthly',
    anchorDate: item.anchorDate || item.due || todayStr,
    slot: item.slot || 'any',
  })) : [];
  DB.goals = Array.isArray(docs[DOC_KEYS.goals]) ? docs[DOC_KEYS.goals] : [];
  DB.checklist = normalizeChecklistValue(docs[DOC_KEYS.checklistState], {});
  DB.checklistDef = normalizeChecklistValue(docs[DOC_KEYS.checklistDef], DEFAULT_CHECKLIST_DEF);
  DB.settings = { ...EMPTY_SETTINGS, ...normalizeChecklistValue(docs[DOC_KEYS.settings], EMPTY_SETTINGS) };

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
  byId('auth-pass-confirm').value = '';
}

function setAuthMode(mode, options = {}) {
  authMode = mode;
  const signup = mode === 'signup';
  const recovery = mode === 'recovery';
  byId('auth-signup-fields').style.display = signup ? 'block' : 'none';
  byId('auth-pass-confirm-wrap').style.display = signup || recovery ? 'block' : 'none';
  byId('auth-submit-btn').textContent = signup ? 'Create Account →' : recovery ? 'Reset Password →' : 'Sign In →';
  byId('auth-toggle-btn').textContent = signup ? 'Back to sign in' : recovery ? 'Back to sign in' : 'Create an account';
  byId('auth-helper-text').textContent = signup
    ? 'New team members can create their own account here. The first signup becomes admin.'
    : recovery
      ? 'Enter and confirm a new password for your account.'
      : 'Use your work email and password. Sessions stay active across refreshes.';
  byId('auth-forgot-btn').style.display = recovery || signup ? 'none' : '';
  byId('auth-user').disabled = recovery && Boolean(options.lockEmail);
  if (recovery && options.email) byId('auth-user').value = options.email;
  setAuthMessage('');
}

async function doLogin() {
  if (!SUPABASE_READY) {
    setAuthMessage('Create supabase/config.js with your Supabase URL and anon key first.');
    return;
  }

  const email = byId('auth-user').value.trim().toLowerCase();
  const password = byId('auth-pass').value;
  if ((!email && authMode !== 'recovery') || !password) {
    setAuthMessage('Email and password are required.');
    return;
  }

  if (authMode === 'recovery') {
    const confirm = byId('auth-pass-confirm').value;
    if (password.length < 8) {
      setAuthMessage('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setAuthMessage('Password confirmation does not match.');
      return;
    }
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) {
      setAuthMessage(error.message);
      return;
    }
    setAuthMessage('Password reset complete. Loading your workspace…', 'success');
    byId('auth-pass').value = '';
    byId('auth-pass-confirm').value = '';
    recoveringPassword = false;
    if (data.user) {
      await hydrateFromSession(data.user);
      return;
    }
    setAuthMode('signin');
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

async function requestPasswordReset() {
  if (!SUPABASE_READY) {
    setAuthMessage('Create supabase/config.js with your Supabase URL and anon key first.');
    return;
  }
  const email = byId('auth-user').value.trim().toLowerCase();
  if (!email) {
    setAuthMessage('Enter your email first, then request a reset link.');
    return;
  }
  const redirectTo = window.location.href.split('#')[0];
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    setAuthMessage(error.message);
    return;
  }
  setAuthMessage('Password reset link sent. Check your email.', 'success');
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
  guidelines: 'Brand Values & Guidelines',
  focus: 'Focus Timer',
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
  const types = ['All', ...clientTypeOptions()];
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
  const primaryClient = getClient(getPrimaryClientId(task));
  const assigneeIds = getAssignedIds(task);
  const user = getUser(assigneeIds[0]);
  const clientNames = getTaskClientNames(task);
  const assigneeNames = getTaskAssigneeNames(task);
  const canManage = editable && canManageTask(task);
  const canEditDetails = editable && canEditTaskDetails(task);
  const editBtn = canEditDetails ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="editTask('${task.id}')" title="Edit">✏️</button>` : '';
  const delBtn = editable && canEditTaskDetails(task) ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteTask('${task.id}')" title="Delete">×</button>` : '';
  const moveUpBtn = cols === 'team' && canManage ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="moveMyTask('${task.id}',-1)" title="Move up">↑</button>` : '';
  const moveDownBtn = cols === 'team' && canManage ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="moveMyTask('${task.id}',1)" title="Move down">↓</button>` : '';
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
  const slotMeta = task.slot && task.slot !== 'any' ? `<div class="t-notes">${slotLabel(task.slot)}</div>` : '';

  if (cols === 'team') {
    return `<tr class="${isDone ? 'is-done' : ''}" id="tr-${task.id}">
      <td><input type="checkbox" class="ck" ${isDone ? 'checked' : ''} onchange="toggleDone('${task.id}')"></td>
      <td><div class="t-name">${task.name}</div>${task.brief ? `<div class="t-notes">${task.brief.substring(0, 60)}${task.brief.length > 60 ? '…' : ''}</div>` : ''}${slotMeta}</td>
      <td><span style="font-size:11px;color:${primaryClient.color}">${clientNames}</span></td>
      <td><span class="badge ${typeClass(task.type)}">${task.type}</span></td>
      <td>${dueDateEl(task.due)}</td>
      <td><span class="status ${statusClass(task.status)}${statusReadonly}" ${statusAction}>${statusLabel(task.status)}</span></td><td style="white-space:nowrap">${moveUpBtn}${moveDownBtn}</td>
    </tr>`;
  }

  return `<tr class="${isDone ? 'is-done' : ''}" id="tr-${task.id}">
    <td><input type="checkbox" class="ck" ${isDone ? 'checked' : ''} onchange="toggleDone('${task.id}')"></td>
    <td><div class="t-name">${task.name}${refsHtml}</div>${task.brief ? `<div class="t-notes">${task.brief.substring(0, 60)}${task.brief.length > 60 ? '…' : ''}</div>` : ''}${slotMeta}</td>
    <td><span style="font-size:12px;color:${primaryClient.color};font-weight:600">${clientNames}</span></td>
    <td><span class="badge ${typeClass(task.type)}">${task.type}</span></td>
    <td><div style="display:flex;align-items:center;gap:6px"><div class="avatar" style="width:22px;height:22px;font-size:9px;background:${user.color}22;color:${user.color}">${user.name.charAt(0)}</div><span style="font-size:12px;color:var(--muted)">${assigneeNames}</span></div></td>
    <td>${dueDateEl(task.due)}</td>
    <td>${priorityEl}</td>
    <td><span class="status ${statusClass(task.status)}${statusReadonly}" ${statusAction}>${statusLabel(task.status)}</span></td>
    <td style="white-space:nowrap">${editBtn}${delBtn}</td>
  </tr>`;
}

function fillTable(bodyId, tasks, cols = 'full') {
  const body = byId(bodyId);
  if (!body) return;
  const colspan = cols === 'team' ? 7 : 9;
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
      el.textContent = visibleTasks().filter((task) => task.status !== 'done' && taskMatchesClient(task, client.id)).length;
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
  if (activeFilters.client !== 'All') tasks = tasks.filter((task) => taskMatchesClient(task, activeFilters.client));
  if (activeFilters.type !== 'All') tasks = tasks.filter((task) => task.type === activeFilters.type);
  if (activeFilters.status === 'overdue') tasks = tasks.filter((task) => task.status !== 'done' && daysFrom(task.due) < 0);
  if (activeFilters.assigned !== 'All') tasks = tasks.filter((task) => taskAssignedTo(task, activeFilters.assigned));
  tasks = tasks.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (b.status === 'done' && a.status !== 'done') return -1;
    return a.sortOrder - b.sortOrder || new Date(a.due) - new Date(b.due);
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
    ${dayTasks.map((task) => `<div class="day-task"><div class="dt-name">${task.name}</div><div class="dt-client">${getTaskClientNames(task)}</div></div>`).join('') || '<div style="padding:14px;text-align:center;color:var(--border2);font-size:20px">·</div>'}
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
  const monthTasks = visibleTasks().filter((task) => isSameMonth(task.due, VIEW_DATE)).sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.due) - new Date(b.due));
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
  try {
    const calendarUrl = byId('cal-url-input').value.trim();
    await ensureSession();
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
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to save calendar URL', 'error');
  }
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
  const clients = isAdmin() ? [...DB.clients].sort((a, b) => a.sortOrder - b.sortOrder) : visibleClients();
  byId('clients-grid').innerHTML = clients.map((client, index) => {
    const taskCount = visibleTasks().filter((task) => taskMatchesClient(task, client.id) && task.status !== 'done').length;
    const editBtn = canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editClient('${client.id}')">Edit</button>` : '';
    const addTaskBtn = canCreateTask() ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openTaskModal('${client.id}')">+ Task</button>` : '';
    const moveUpBtn = canEdit() ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();moveClient('${client.id}',-1)" ${index === 0 ? 'disabled' : ''}>↑</button>` : '';
    const moveDownBtn = canEdit() ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();moveClient('${client.id}',1)" ${index === clients.length - 1 ? 'disabled' : ''}>↓</button>` : '';
    const delBtn = isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteClient('${client.id}')">×</button>` : '';
    return `<div class="client-card">
      <div class="client-card-head" onclick="showPage('tasks');setFilter('client','${client.id}')" style="cursor:pointer">
        <div class="client-color-bar" style="background:${client.color}"></div>
        <div class="client-info"><div class="client-name">${client.name}</div><div class="client-type-badge">${client.type} · ${client.category || client.industry || '—'}</div></div>
        <div class="client-card-actions">${moveUpBtn}${moveDownBtn}${addTaskBtn}${editBtn}${delBtn}</div>
      </div>
      <div class="client-card-body">
        ${client.brief ? `<div class="client-detail-row"><span class="client-detail-label">Brief</span><span class="client-detail-val" style="font-size:12px;color:var(--muted)">${client.brief.substring(0, 80)}${client.brief.length > 80 ? '…' : ''}</span></div>` : ''}
        ${!isProjectType(client.type, client.billingModel) ? `<div class="client-detail-row"><span class="client-detail-label">Strategy due</span><span class="client-detail-val">Day ${client.stratDay || '—'} of month</span></div>` : ''}
        ${(client.paperFee || client.actualFee) ? `<div class="client-detail-row"><span class="client-detail-label">${clientRevenueLabel(client, 'paper')}</span><span class="client-detail-val">₹${Number(client.paperFee || 0).toLocaleString('en-IN')}</span></div><div class="client-detail-row"><span class="client-detail-label">${clientRevenueLabel(client, 'actual')}</span><span class="client-detail-val">₹${Number(client.actualFee || 0).toLocaleString('en-IN')}</span></div>` : ''}
        ${client.projectStartDate || client.projectEndDate ? `<div class="client-detail-row"><span class="client-detail-label">Timeline</span><span class="client-detail-val">${client.projectStartDate ? fmtDate(client.projectStartDate) : '—'} to ${client.projectEndDate ? fmtDate(client.projectEndDate) : '—'}</span></div>` : ''}
        ${client.timeline?.length ? `<div class="client-detail-row"><span class="client-detail-label">Milestones</span><span class="client-detail-val">${client.timeline.length}</span></div>` : ''}
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
    const client = getClient(item.clientIds?.[0]);
    const delBtn = canEdit() ? `<button class="btn btn-danger btn-sm" onclick="deleteRecurring('${item.id}')">× Remove</button>` : '';
    const editBtn = canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="editRecurring('${item.id}')">Edit</button>` : '';
    return `<div class="template-card">
      <div class="template-head" onclick="this.classList.toggle('expanded');this.nextElementSibling.classList.toggle('open')">
        <span style="width:8px;height:8px;border-radius:50%;background:${client.color};display:inline-block"></span>
        <span style="font-weight:600;font-size:13px">${item.name}</span>
        <span class="badge ${typeClass(item.type)}" style="margin-left:8px">${item.type}</span>
        <span style="font-size:12px;color:var(--muted);margin-left:8px">→ ${getTaskClientNames(item)} · ${taskRepeatLabel(item) || 'Monthly'} · ${fmtDate(item.anchorDate || item.due)}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--muted)">Assigned: ${getTaskAssigneeNames(item)}</span>
        <span class="expand-icon">▾</span>
      </div>
      <div class="template-body">
        <div style="padding:12px 16px;display:flex;align-items:center;gap:12px;border-top:1px solid var(--border)">
          <span style="font-size:12px;color:var(--muted)">Priority: <strong>${item.priority}</strong></span>
          <span style="font-size:12px;color:var(--muted)">Slot: ${slotLabel(item.slot)}</span>
          ${item.reminders?.length ? `<span style="font-size:12px;color:var(--muted)">Reminders: ${item.reminders.map((entry) => `${entry.daysBefore}d @ ${entry.time}`).join(', ')}</span>` : ''}
          ${item.brief ? `<span style="font-size:12px;color:var(--muted)">Brief: ${item.brief}</span>` : ''}
          <div class="template-actions">${editBtn}${delBtn}</div>
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
  const myTasks = DB.tasks.filter((task) => taskAssignedTo(task, CURRENT_USER.id) && task.status !== 'done').sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.due) - new Date(b.due));
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
        ${client.guidelines ? `<div class="brief-section"><div class="brief-section-label">Values & Guidelines</div><div class="brief-section-text">${client.guidelines}</div></div>` : ''}
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
    const tasks = DB.tasks.filter((task) => taskAssignedTo(task, user.id)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const open = tasks.filter((task) => task.status !== 'done').length;
    const review = tasks.filter((task) => task.status === 'review').length;
    const done = tasks.filter((task) => task.status === 'done').length;
    const updates = tasks.slice(0, 3).map((task) => `<div class="team-update-item"><div class="team-update-item-title">${task.name}</div><div class="team-update-item-meta">${statusLabel(task.status)} · ${fmtDateTime(task.updatedAt)} · ${getTaskClientNames(task)}</div></div>`).join('') || '<div class="team-update-item"><div class="team-update-item-title">No task updates yet</div></div>';
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
  if (currentPage === 'guidelines') renderGuidelines();
  if (currentPage === 'focus') renderFocusTimer();
  if (currentPage === 'calendar') renderCalendar();
  if (currentPage === 'clients') renderClients();
  if (currentPage === 'team') renderTeam();
  if (currentPage === 'recurring') renderRecurring();
  if (currentPage === 'settings') renderSettings();
  if (currentPage === 'mywork') renderMyWork();
}

function renderCheckboxList(containerId, items, selectedIds = [], disabled = false) {
  const container = byId(containerId);
  if (!container) return;
  const selected = new Set(normalizeIdList(selectedIds));
  container.innerHTML = items.map((item) => `<label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" class="ck" value="${item.id}" ${selected.has(item.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${item.label}</label>`).join('');
}

function getCheckedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map((input) => input.value);
}

function addReminderRow(value = { daysBefore: 1, time: DEFAULT_REMINDER_TIME }, containerId = 'task-reminders-list') {
  const container = byId(containerId);
  if (!container) return;
  const rowId = `reminder-row-${taskReminderCount}`;
  const div = document.createElement('div');
  div.className = 'form-row';
  div.id = rowId;
  div.innerHTML = `<div class="form-group"><label class="form-label">Days Before</label><input class="form-control reminder-days" type="number" min="0" value="${value.daysBefore ?? 1}"></div><div class="form-group"><label class="form-label">Time</label><div style="display:flex;gap:8px"><input class="form-control reminder-time" type="time" value="${value.time || DEFAULT_REMINDER_TIME}" style="flex:1"><button class="btn btn-danger btn-sm btn-icon" type="button" onclick="document.getElementById('${rowId}').remove()">×</button></div></div>`;
  container.appendChild(div);
  taskReminderCount += 1;
}

function collectReminderRows(containerId = 'task-reminders-list') {
  return normalizeReminderList([...document.querySelectorAll(`#${containerId} .form-row`)].map((row) => ({
    daysBefore: row.querySelector('.reminder-days')?.value,
    time: row.querySelector('.reminder-time')?.value || DEFAULT_REMINDER_TIME,
  })));
}

function addTimelineRow(item = {}) {
  const container = byId('client-timeline-list');
  if (!container) return;
  const timeline = normalizeTimelineItem(item);
  const rowId = `timeline-row-${clientTimelineCount}`;
  const div = document.createElement('div');
  div.className = 'card card-sm';
  div.id = rowId;
  div.dataset.timelineId = timeline.id;
  div.innerHTML = `<div class="form-row"><div class="form-group"><label class="form-label">Milestone</label><input class="form-control tl-title" value="${timeline.title}"></div><div class="form-group"><label class="form-label">Date</label><input class="form-control tl-date" type="date" value="${timeline.date}"></div></div><div class="form-group"><label class="form-label">Brief</label><textarea class="form-control tl-brief">${timeline.brief || ''}</textarea></div><div class="form-group"><label class="form-label">Assignees</label><div class="tl-assignees" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div></div><div style="display:flex;justify-content:flex-end"><button class="btn btn-danger btn-sm" type="button" onclick="document.getElementById('${rowId}').remove()">Remove milestone</button></div>`;
  container.appendChild(div);
  const assigneeWrap = div.querySelector('.tl-assignees');
  assigneeWrap.innerHTML = DB.users.map((user) => `<label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" class="ck" value="${user.id}" ${timeline.assignedIds.includes(user.id) ? 'checked' : ''}> ${user.name}</label>`).join('');
  clientTimelineCount += 1;
}

function collectTimelineRows() {
  return [...document.querySelectorAll('#client-timeline-list > .card')].map((row) => ({
    id: row.dataset.timelineId || newId('tl'),
    title: row.querySelector('.tl-title')?.value.trim(),
    date: row.querySelector('.tl-date')?.value || todayStr,
    brief: row.querySelector('.tl-brief')?.value.trim() || '',
    assignedIds: [...row.querySelectorAll('.tl-assignees input:checked')].map((input) => input.value),
  })).filter((item) => item.title);
}

function updateClientFormVisibility() {
  const type = byId('c-type').value;
  const project = isProjectType(type, byId('c-billing-model')?.value || '');
  const feeLabel = byId('c-fee-label');
  const projectFields = byId('client-project-fields');
  if (feeLabel) feeLabel.textContent = project ? 'Project Fee (₹)' : 'Monthly Retainer Fee (₹)';
  if (projectFields) projectFields.style.display = project ? '' : 'none';
}

function populateTaskModal(selectedClientId = '') {
  const clients = isAdmin() || CURRENT_USER?.role === 'manager' ? DB.clients : visibleClients();
  const defaultClientIds = selectedClientId ? [selectedClientId] : activeFilters.client !== 'All' ? [activeFilters.client] : clients[0] ? [clients[0].id] : [];
  renderCheckboxList('t-client-list', clients.map((client) => ({ id: client.id, label: client.name })), defaultClientIds);
  renderCheckboxList('t-assigned-list', DB.users.map((user) => ({ id: user.id, label: user.name })), CURRENT_USER?.role === 'team' ? [CURRENT_USER.id] : []);
  if (CURRENT_USER?.role === 'team') {
    renderCheckboxList('t-assigned-list', DB.users.map((user) => ({ id: user.id, label: user.name })), [CURRENT_USER.id], true);
  }
  byId('t-type').value = getClient(defaultClientIds[0]).type || 'Retainer';
  byId('task-reminders-list').innerHTML = '';
  taskReminderCount = 0;
  addReminderRow();
}

function openModal(id) {
  byId(id).classList.add('open');
}

function closeModal(id) {
  byId(id).classList.remove('open');
}

function openTaskModal(selectedClientId = '') {
  if (!canCreateTask()) {
    showToast('Sign in to create tasks.', 'error');
    return;
  }
  populateTaskModal(selectedClientId);
  byId('edit-task-id').value = '';
  byId('task-modal-title').textContent = 'Add Task';
  byId('t-name').value = '';
  byId('t-brief').value = '';
  byId('t-start').value = '';
  byId('t-due').value = todayStr;
  byId('t-priority').value = 'Medium';
  byId('t-slot').value = 'any';
  byId('t-status').value = 'todo';
  byId('t-refs').value = '';
  byId('t-repeat-type').value = 'none';
  openModal('task-modal');
}

function editTask(id) {
  if (!canManageTask(DB.tasks.find((entry) => entry.id === id))) {
    showToast('You do not have access to edit this task.', 'error');
    return;
  }
  const task = DB.tasks.find((entry) => entry.id === id);
  if (!task) return;
  populateTaskModal(getPrimaryClientId(task));
  byId('edit-task-id').value = id;
  byId('task-modal-title').textContent = 'Edit Task';
  byId('t-name').value = task.name;
  byId('t-brief').value = task.brief || '';
  byId('t-start').value = task.start || '';
  renderCheckboxList('t-client-list', (isAdmin() || CURRENT_USER?.role === 'manager' ? DB.clients : visibleClients()).map((client) => ({ id: client.id, label: client.name })), getClientIds(task));
  byId('t-type').value = task.type;
  byId('t-due').value = task.due;
  byId('t-priority').value = task.priority;
  byId('t-slot').value = task.slot || 'any';
  byId('t-status').value = task.status;
  renderCheckboxList('t-assigned-list', DB.users.map((user) => ({ id: user.id, label: user.name })), getAssignedIds(task), CURRENT_USER?.role === 'team');
  byId('t-refs').value = task.refs || '';
  byId('t-repeat-type').value = task.repeatType || 'none';
  byId('task-reminders-list').innerHTML = '';
  taskReminderCount = 0;
  (task.reminders?.length ? task.reminders : [{ daysBefore: 1, time: DEFAULT_REMINDER_TIME }]).forEach((entry) => addReminderRow(entry));
  openModal('task-modal');
}

function syncRecurringTemplateFromTask(task) {
  if (!task.repeatType || task.repeatType === 'none') return task.recurringTemplateId || '';
  const existingId = task.recurringTemplateId || newId('r');
  const template = {
    id: existingId,
    name: task.name,
    client: getPrimaryClientId(task),
    clientIds: getClientIds(task),
    type: task.type,
    anchorDate: task.due,
    startDate: task.start || '',
    priority: task.priority,
    assigned: getAssignedIds(task)[0] || '',
    assignedIds: getAssignedIds(task),
    reminders: getReminderList(task),
    repeatType: task.repeatType || 'monthly',
    slot: task.slot || 'any',
    brief: task.brief,
  };
  const idx = DB.recurring.findIndex((item) => item.id === existingId);
  if (idx >= 0) DB.recurring[idx] = template;
  else DB.recurring.push(template);
  return existingId;
}

async function saveTask() {
  if (!canCreateTask()) {
    showToast('Sign in to save tasks.', 'error');
    return;
  }
  const name = byId('t-name').value.trim();
  if (!name) {
    showToast('Task name is required', 'error');
    return;
  }
  const clientIds = getCheckedValues('t-client-list');
  const assignedIds = CURRENT_USER?.role === 'team' ? [CURRENT_USER.id] : getCheckedValues('t-assigned-list');
  const due = byId('t-due').value;
  if (!due) {
    showToast('Due date is required', 'error');
    return;
  }

  const id = byId('edit-task-id').value || crypto.randomUUID();
  const task = {
    id,
    name,
    brief: byId('t-brief').value.trim(),
    client: clientIds[0] || '',
    clientIds,
    type: byId('t-type').value,
    start: byId('t-start').value,
    due,
    priority: byId('t-priority').value,
    slot: byId('t-slot').value,
    status: byId('t-status').value,
    assigned: assignedIds[0] || '',
    assignedIds,
    refs: byId('t-refs').value.trim(),
    remind: 'none',
    reminders: collectReminderRows(),
    recurring: byId('t-repeat-type').value === 'none' ? 'no' : 'yes',
    repeatType: byId('t-repeat-type').value,
    recurringTemplateId: DB.tasks.find((entry) => entry.id === id)?.recurringTemplateId || '',
    sortOrder: DB.tasks.find((entry) => entry.id === id)?.sortOrder || (DB.tasks.length + 1),
    updatedAt: new Date().toISOString(),
    updatedBy: CURRENT_USER?.id || '',
  };
  if (!canEditTaskDetails()) {
    task.assigned = CURRENT_USER.id;
    task.assignedIds = [CURRENT_USER.id];
    task.status = 'todo';
  }
  task.recurringTemplateId = syncRecurringTemplateFromTask(task);

  try {
    await ensureSession();
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
  if (!canEdit()) {
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
    await ensureSession();
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

async function moveMyTask(id, direction) {
  const scoped = DB.tasks.filter((task) => taskAssignedTo(task, CURRENT_USER.id) && task.status !== 'done').sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.due) - new Date(b.due));
  const index = scoped.findIndex((task) => task.id === id);
  const swapIndex = index + direction;
  if (index < 0 || swapIndex < 0 || swapIndex >= scoped.length) return;
  const task = scoped[index];
  const swapTask = scoped[swapIndex];
  try {
    await ensureSession();
    const { error: firstError } = await supabase.from('tasks').update({ sort_order: swapTask.sortOrder }).eq('id', task.id);
    if (firstError) throw firstError;
    const { error: secondError } = await supabase.from('tasks').update({ sort_order: task.sortOrder }).eq('id', swapTask.id);
    if (secondError) throw secondError;
    await loadWorkspace();
    renderMyWork();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to reorder task', 'error');
  }
}

function openClientModal() {
  if (!canEdit()) {
    showToast('Only admins and managers can manage clients.', 'error');
    return;
  }
  byId('edit-client-id').value = '';
  byId('client-modal-title').textContent = 'Add Client / Project';
  ['c-name', 'c-industry', 'c-category', 'c-brief', 'c-guidelines', 'c-drive', 'c-contact', 'c-email', 'c-project-start', 'c-project-end'].forEach((id) => {
    byId(id).value = '';
  });
  byId('c-type').value = 'Retainer';
  byId('c-billing-model').value = 'retainer';
  byId('c-color').value = '#6eb5ff';
  byId('c-strat-day').value = '20';
  byId('c-fee').value = '';
  byId('c-paper-fee').value = '';
  byId('c-actual-fee').value = '';
  byId('client-timeline-list').innerHTML = '';
  clientTimelineCount = 0;
  updateClientFormVisibility();
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
  byId('c-billing-model').value = client.billingModel || (isProjectType(client.type) ? 'project' : 'retainer');
  byId('c-industry').value = client.industry || '';
  byId('c-category').value = client.category || '';
  byId('c-color').value = client.color || '#6eb5ff';
  byId('c-brief').value = client.brief || '';
  byId('c-guidelines').value = client.guidelines || '';
  byId('c-strat-day').value = client.stratDay || 20;
  byId('c-drive').value = client.drive || '';
  byId('c-contact').value = client.contact || '';
  byId('c-email').value = client.email || '';
  byId('c-fee').value = client.fee || '';
  byId('c-paper-fee').value = client.paperFee || '';
  byId('c-actual-fee').value = client.actualFee || '';
  byId('c-project-start').value = client.projectStartDate || '';
  byId('c-project-end').value = client.projectEndDate || '';
  byId('client-timeline-list').innerHTML = '';
  clientTimelineCount = 0;
  (client.timeline || []).forEach((item) => addTimelineRow(item));
  updateClientFormVisibility();
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
    billing_model: byId('c-billing-model').value,
    industry: byId('c-industry').value.trim(),
    category: byId('c-category').value.trim(),
    color: byId('c-color').value,
    brief: byId('c-brief').value.trim(),
    guidelines: byId('c-guidelines').value.trim(),
    strat_day: parseInt(byId('c-strat-day').value, 10) || 20,
    drive: byId('c-drive').value.trim(),
    contact: byId('c-contact').value.trim(),
    email: byId('c-email').value.trim(),
    fee: parseFloat(byId('c-fee').value || '0') || 0,
    paper_fee: parseFloat(byId('c-paper-fee').value || '0') || 0,
    actual_fee: parseFloat(byId('c-actual-fee').value || '0') || 0,
    project_start_date: byId('c-project-start').value || null,
    project_end_date: byId('c-project-end').value || null,
    timeline: collectTimelineRows(),
    sort_order: DB.clients.find((entry) => entry.id === id)?.sortOrder || (DB.clients.length + 1),
  };
  try {
    await ensureSession();
    const { error } = await supabase.from('clients').upsert(client);
    if (error) throw error;
    await syncClientTimelineTasks(client);
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
    await ensureSession();
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
  byId('edit-recurring-id').value = '';
  byId('recurring-modal-title').textContent = 'Add Recurring Template';
  ['r-name', 'r-brief', 'r-start'].forEach((id) => {
    byId(id).value = '';
  });
  byId('r-anchor').value = todayStr;
  byId('r-priority').value = 'Medium';
  byId('r-type').value = 'Retainer';
  byId('r-slot').value = 'any';
  byId('r-repeat-type').value = 'monthly';
  renderCheckboxList('r-client-list', (isAdmin() || CURRENT_USER?.role === 'manager' ? DB.clients : visibleClients()).map((client) => ({ id: client.id, label: client.name })), []);
  renderCheckboxList('r-assigned-list', DB.users.map((user) => ({ id: user.id, label: user.name })), []);
  byId('recurring-reminders-list').innerHTML = '';
  taskReminderCount = 0;
  addReminderRow({ daysBefore: 1, time: DEFAULT_REMINDER_TIME }, 'recurring-reminders-list');
  openModal('recurring-modal');
}

function editRecurring(id) {
  if (!canEdit()) {
    showToast('Only admins and managers can manage recurring templates.', 'error');
    return;
  }
  const template = DB.recurring.find((item) => item.id === id);
  if (!template) return;
  openRecurringModal();
  byId('edit-recurring-id').value = id;
  byId('recurring-modal-title').textContent = 'Edit Recurring Template';
  byId('r-name').value = template.name;
  byId('r-brief').value = template.brief || '';
  byId('r-start').value = template.startDate || '';
  byId('r-anchor').value = template.anchorDate || todayStr;
  byId('r-priority').value = template.priority;
  byId('r-type').value = template.type;
  byId('r-slot').value = template.slot || 'any';
  byId('r-repeat-type').value = template.repeatType || 'monthly';
  renderCheckboxList('r-client-list', (isAdmin() || CURRENT_USER?.role === 'manager' ? DB.clients : visibleClients()).map((client) => ({ id: client.id, label: client.name })), template.clientIds || []);
  renderCheckboxList('r-assigned-list', DB.users.map((user) => ({ id: user.id, label: user.name })), template.assignedIds || []);
  byId('recurring-reminders-list').innerHTML = '';
  taskReminderCount = 0;
  (template.reminders?.length ? template.reminders : [{ daysBefore: 1, time: DEFAULT_REMINDER_TIME }]).forEach((entry) => addReminderRow(entry, 'recurring-reminders-list'));
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
  const id = byId('edit-recurring-id').value || newId('r');
  const template = {
    id,
    name,
    client: getCheckedValues('r-client-list')[0] || '',
    clientIds: getCheckedValues('r-client-list'),
    type: byId('r-type').value,
    anchorDate: byId('r-anchor').value || todayStr,
    startDate: byId('r-start').value || '',
    priority: byId('r-priority').value,
    assigned: getCheckedValues('r-assigned-list')[0] || '',
    assignedIds: getCheckedValues('r-assigned-list'),
    reminders: collectReminderRows('recurring-reminders-list'),
    repeatType: byId('r-repeat-type').value,
    slot: byId('r-slot').value,
    brief: byId('r-brief').value.trim(),
  };
  const idx = DB.recurring.findIndex((item) => item.id === id);
  if (idx >= 0) DB.recurring[idx] = template;
  else DB.recurring.push(template);
  try {
    await persistRecurring();
    closeModal('recurring-modal');
    renderRecurring();
    showToast(idx >= 0 ? 'Recurring template updated' : 'Recurring template added', 'success');
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
    const { error: taskError } = await supabase.from('tasks').delete().eq('recurring_template_id', id);
    if (taskError) throw taskError;
    await loadWorkspace();
    renderRecurring();
    showToast('Template removed', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to remove template', 'error');
  }
}

async function syncClientTimelineTasks(clientRow) {
  const client = {
    id: clientRow.id,
    name: clientRow.name,
    type: clientRow.type,
    timeline: Array.isArray(clientRow.timeline) ? clientRow.timeline : [],
  };
  const existingTasks = DB.tasks.filter((task) => task.sourceClientTimelineId && taskMatchesClient(task, client.id));
  const existingMap = new Map(existingTasks.map((task) => [task.sourceClientTimelineId, task]));
  const nextTimeline = client.timeline.map(normalizeTimelineItem);
  const upserts = nextTimeline.map((item, index) => mapTaskToRow({
    id: existingMap.get(item.id)?.id || crypto.randomUUID(),
    name: item.title,
    brief: item.brief || '',
    client: client.id,
    clientIds: [client.id],
    type: client.type,
    start: '',
    due: item.date,
    priority: 'Medium',
    slot: 'any',
    status: existingMap.get(item.id)?.status || 'todo',
    assigned: item.assignedIds?.[0] || '',
    assignedIds: normalizeIdList(item.assignedIds || []),
    refs: '',
    reminders: [],
    repeatType: 'none',
    recurringTemplateId: '',
    cleanupAfterDays: 14,
    sourceClientTimelineId: item.id,
    autoGenerated: true,
    sortOrder: index + 1,
    updatedBy: CURRENT_USER?.id || '',
  }));
  const staleIds = existingTasks.filter((task) => !nextTimeline.some((item) => item.id === task.sourceClientTimelineId)).map((task) => task.id);
  if (upserts.length) {
    const { error } = await supabase.from('tasks').upsert(upserts);
    if (error) throw error;
  }
  if (staleIds.length) {
    const { error } = await supabase.from('tasks').delete().in('id', staleIds);
    if (error) throw error;
  }
}

async function moveClient(id, direction) {
  const clients = [...DB.clients].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = clients.findIndex((client) => client.id === id);
  const swapIndex = index + direction;
  if (index < 0 || swapIndex < 0 || swapIndex >= clients.length) return;
  const current = clients[index];
  const swap = clients[swapIndex];
  try {
    await ensureSession();
    const { error: firstError } = await supabase.from('clients').update({ sort_order: swap.sortOrder }).eq('id', current.id);
    if (firstError) throw firstError;
    const { error: secondError } = await supabase.from('clients').update({ sort_order: current.sortOrder }).eq('id', swap.id);
    if (secondError) throw secondError;
    await loadWorkspace();
    buildNavClientList();
    renderClients();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to move client', 'error');
  }
}

function renderGuidelines() {
  const clients = visibleClients();
  const wrap = byId('guidelines-grid');
  if (!wrap) return;
  wrap.innerHTML = clients.map((client) => `<div class="brief-card"><div class="brief-head"><span class="brief-client-dot" style="background:${client.color}"></span><span class="brief-client-name">${client.name}</span><span class="brief-type">${client.type}</span></div><div class="brief-body">${client.guidelines ? `<div class="brief-section"><div class="brief-section-label">Values & Guidelines</div><div class="brief-section-text">${client.guidelines}</div></div>` : `<div style="color:var(--muted);font-size:13px">No guidelines added yet.</div>`}${canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="editClient('${client.id}')">Edit Guidelines</button>` : ''}</div></div>`).join('') || '<div style="color:var(--muted);font-size:13px">No brands assigned to you yet.</div>';
}

function focusTimerDuration(mode) {
  const prefs = getFocusPrefs();
  const minutes = mode === 'focus' ? prefs.focusMinutes : prefs.breakMinutes;
  return (parseInt(minutes, 10) || 1) * 60 * 1000;
}

function stopFocusInterval() {
  if (focusTimerState.intervalId) clearInterval(focusTimerState.intervalId);
  focusTimerState.intervalId = null;
}

function saveFocusSession(mode, durationMs) {
  const current = getFocusSessions();
  setFocusSessions([{ mode, minutes: Math.round(durationMs / 60000), finishedAt: new Date().toISOString() }, ...current].slice(0, 10));
}

function updateFocusDisplay() {
  const remaining = Math.max(0, focusTimerState.remainingMs);
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  if (byId('focus-timer-value')) byId('focus-timer-value').textContent = `${minutes}:${seconds}`;
  if (byId('focus-timer-mode')) byId('focus-timer-mode').textContent = focusTimerState.mode === 'focus' ? 'Deep Work' : 'Break';
}

function startFocusTimer() {
  if (focusTimerState.running) return;
  focusTimerState.running = true;
  focusTimerState.endsAt = Date.now() + focusTimerState.remainingMs;
  stopFocusInterval();
  focusTimerState.intervalId = setInterval(() => {
    focusTimerState.remainingMs = Math.max(0, focusTimerState.endsAt - Date.now());
    updateFocusDisplay();
    if (focusTimerState.remainingMs <= 0) {
      stopFocusInterval();
      focusTimerState.running = false;
      saveFocusSession(focusTimerState.mode, focusTimerDuration(focusTimerState.mode));
      focusTimerState.mode = focusTimerState.mode === 'focus' ? 'break' : 'focus';
      focusTimerState.remainingMs = focusTimerDuration(focusTimerState.mode);
      renderFocusTimer();
      showToast('Focus timer complete', 'success');
    }
  }, 1000);
}

function pauseFocusTimer() {
  if (!focusTimerState.running) return;
  focusTimerState.running = false;
  focusTimerState.remainingMs = Math.max(0, focusTimerState.endsAt - Date.now());
  stopFocusInterval();
  updateFocusDisplay();
}

function resetFocusTimer(mode = focusTimerState.mode) {
  focusTimerState.mode = mode;
  focusTimerState.running = false;
  stopFocusInterval();
  focusTimerState.remainingMs = focusTimerDuration(mode);
  updateFocusDisplay();
  renderFocusTimer();
}

function renderFocusTimer() {
  const wrap = byId('focus-panel');
  if (!wrap) return;
  const sessions = getFocusSessions();
  const prefs = getFocusPrefs();
  wrap.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><div class="stat-label">Mode</div><div id="focus-timer-mode" class="stat-sub">${focusTimerState.mode === 'focus' ? 'Deep Work' : 'Break'}</div></div><div id="focus-timer-value" class="stat-val">${Math.floor(focusTimerState.remainingMs / 60000).toString().padStart(2, '0')}:${Math.floor((focusTimerState.remainingMs % 60000) / 1000).toString().padStart(2, '0')}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" onclick="startFocusTimer()">Start</button><button class="btn btn-ghost" onclick="pauseFocusTimer()">Pause</button><button class="btn btn-ghost" onclick="resetFocusTimer('focus')">Reset Focus</button><button class="btn btn-ghost" onclick="resetFocusTimer('break')">Reset Break</button></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px"><div class="form-group"><label class="form-label">Focus Minutes</label><input id="focus-minutes" class="form-control" type="number" min="1" value="${prefs.focusMinutes}"></div><div class="form-group"><label class="form-label">Break Minutes</label><input id="break-minutes" class="form-control" type="number" min="1" value="${prefs.breakMinutes}"></div></div><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="saveFocusPresets()">Save Presets</button></div><div class="card" style="margin-top:16px"><div style="font-size:13px;font-weight:600;margin-bottom:10px">Recent Sessions</div>${sessions.map((session) => `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">${session.mode} · ${session.minutes}m · ${fmtDateTime(session.finishedAt)}</div>`).join('') || '<div style="font-size:12px;color:var(--muted)">No completed sessions yet.</div>'}</div>`;
  updateFocusDisplay();
}

async function saveFocusPresets() {
  const prefs = {
    focusMinutes: parseInt(byId('focus-minutes').value, 10) || 50,
    breakMinutes: parseInt(byId('break-minutes').value, 10) || 10,
  };
  setFocusPrefs(prefs);
  resetFocusTimer('focus');
}

async function checkRecurringGeneration() {
  if (!DB.recurring.length || !canEdit()) return;
  const inserts = [];
  DB.recurring.forEach((template) => {
    const due = getDueDateForTemplate(template, TODAY);
    const exists = DB.tasks.some((task) => task.recurringTemplateId === template.id && task.due === due);
    if (exists) return;
    inserts.push(mapTaskToRow({
      id: crypto.randomUUID(),
      name: template.name,
      brief: template.brief || '',
      client: template.clientIds?.[0] || '',
      clientIds: normalizeIdList(template.clientIds || []),
      type: template.type,
      start: template.startDate || '',
      due,
      priority: template.priority,
      slot: template.slot || 'any',
      status: 'todo',
      assigned: template.assignedIds?.[0] || '',
      assignedIds: normalizeIdList(template.assignedIds || []),
      refs: '',
      reminders: normalizeReminderList(template.reminders || []),
      repeatType: template.repeatType || 'monthly',
      recurringTemplateId: template.id,
      cleanupAfterDays: 14,
      sourceClientTimelineId: '',
      autoGenerated: false,
      sortOrder: DB.tasks.length + inserts.length + 1,
      updatedBy: CURRENT_USER?.id || '',
    }));
  });

  if (!inserts.length) return;
  const { error } = await supabase.from('tasks').insert(inserts);
  if (error) {
    console.error(error);
    return;
  }
  await loadWorkspace();
  renderAll();
  showToast(`${inserts.length} recurring task${inserts.length > 1 ? 's' : ''} generated`, 'success');
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
  if (byId('nav-guidelines-item')) byId('nav-guidelines-item').style.display = visibleClients().length ? '' : 'none';
  if (!focusTimerState.running) focusTimerState.remainingMs = focusTimerDuration(focusTimerState.mode);

  document.querySelectorAll('[onclick="openTaskModal()"]').forEach((button) => {
    button.style.display = canCreateTask() ? '' : 'none';
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
    if ((event.metaKey || event.ctrlKey) && event.key === 'k' && canCreateTask()) {
      event.preventDefault();
      openTaskModal();
    }
  });
  byId('c-type').addEventListener('change', updateClientFormVisibility);
  byId('c-billing-model')?.addEventListener('change', updateClientFormVisibility);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && CURRENT_USER) refreshWorkspaceFromUI().catch((error) => console.error(error));
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

  recoveringPassword = window.location.hash.includes('type=recovery');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    setAuthMessage(sessionError.message);
    return;
  }

  if (sessionData.session?.user) {
    if (recoveringPassword) {
      showAuthScreen();
      setAuthMode('recovery', { email: sessionData.session.user.email || '', lockEmail: true });
    } else {
      await hydrateFromSession(sessionData.session.user);
    }
  } else {
    showAuthScreen();
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      recoveringPassword = true;
      showAuthScreen();
      setAuthMode('recovery', { email: session.user.email || '', lockEmail: true });
      return;
    }
    if (session?.user) {
      recoveringPassword = false;
      await hydrateFromSession(session.user);
    } else {
      recoveringPassword = false;
      showAuthScreen();
    }
  });
}

Object.assign(window, {
  doLogin,
  requestPasswordReset,
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
  moveMyTask,
  openClientModal,
  editClient,
  saveClient,
  deleteClient,
  moveClient,
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
  editRecurring,
  saveRecurring,
  deleteRecurring,
  addReminderRow,
  addTimelineRow,
  saveEmailJS,
  saveFocusPresets,
  startFocusTimer,
  pauseFocusTimer,
  resetFocusTimer,
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
