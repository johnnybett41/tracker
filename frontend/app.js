
const STORAGE_KEY = "multi-tracker-v1";
const ONBOARDING_KEY = "multi-tracker-onboarded-v1";

const trackers = [
  { id: "expenses", label: "Expenses" },
  { id: "habits", label: "Habits" },
  { id: "tasks", label: "Tasks" },
  { id: "inventory", label: "Inventory" }
];

const defaults = {
  expenseCategories: { food: "Food", transport: "Transport", rent: "Rent", utilities: "Utilities", health: "Health", education: "Education", shopping: "Shopping", entertainment: "Entertainment", savings: "Savings", other: "Other" },
  habitDictionary: { workout: "Workout", reading: "Reading", meditation: "Meditation", journaling: "Journaling", hydration: "Drink Water", sleep_early: "Sleep Early", study: "Study", prayer: "Prayer" },
  taskDictionary: { report: "Finish Report", meeting: "Team Meeting", follow_up: "Client Follow-up", budgeting: "Weekly Budget Review", planning: "Plan Next Week", shopping: "Buy Supplies", calls: "Important Calls", personal: "Personal Errands" },
  inventoryItems: { notebook: "Notebook", pen: "Pen", paper: "Paper Ream", stapler: "Stapler", folder: "File Folder", marker: "Marker", toner: "Printer Toner", sanitizer: "Sanitizer" },
  inventoryLocations: { storeroom_a: "Storeroom A", storeroom_b: "Storeroom B", storefront: "Storefront", warehouse: "Warehouse", office: "Office", kitchen: "Kitchen", delivery_van: "Delivery Van" }
};

const dicts = window.TrackerDictionaries?.loadDictionaries?.() || defaults;
const expenseCategories = dicts.expenseCategories || defaults.expenseCategories;
const habitDictionary = dicts.habitDictionary || defaults.habitDictionary;
const taskDictionary = dicts.taskDictionary || defaults.taskDictionary;
const inventoryItems = dicts.inventoryItems || defaults.inventoryItems;
const inventoryLocations = dicts.inventoryLocations || defaults.inventoryLocations;

const state = { expenses: [], habits: [], tasks: [], inventory: [] };
const filters = {
  expenses: { search: "", category: "all", sort: "newest" },
  habits: { search: "", frequency: "all", sort: "az" },
  tasks: { search: "", status: "all", priority: "all", sort: "due" },
  inventory: { search: "", location: "all", stock: "all", sort: "az" }
};

let activeTracker = "expenses";
let quickAddType = "expenses";
let saveTimer = null;
let reminderTimer = null;
let lastReminderFingerprint = "";
let highlightTaskId = "";

const templates = {
  personal: {
    expenses: [{ id: uid(), date: todayISO(), category: "food", amount: 12.5, note: "Lunch" }],
    habits: [{ id: uid(), name: "reading", frequency: "Daily", completions: [todayISO()] }],
    tasks: [{ id: uid(), title: "planning", dueDate: todayISO(), priority: "Medium", done: false }],
    inventory: [{ id: uid(), item: "notebook", quantity: 3, lowStock: 2, location: "office" }]
  },
  business: {
    expenses: [{ id: uid(), date: todayISO(), category: "utilities", amount: 75, note: "Internet bill" }],
    habits: [{ id: uid(), name: "study", frequency: "Daily", completions: [] }],
    tasks: [{ id: uid(), title: "follow_up", dueDate: todayISO(), priority: "High", done: false }],
    inventory: [{ id: uid(), item: "paper", quantity: 8, lowStock: 5, location: "storeroom_a" }]
  },
  blank: { expenses: [], habits: [], tasks: [], inventory: [] }
};

hydrateFromLocal();
init();

function uid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function esc(v) { return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function csv(v) { return `"${String(v ?? "").replaceAll('"', '""')}"`; }
function options(dict) { return Object.entries(dict).map(([k, v]) => `<option value="${k}">${v}</option>`).join(""); }
function contains(text, needle) { return String(text || "").toLowerCase().includes(needle); }

function hydrateFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    state.expenses = p.expenses || [];
    state.habits = p.habits || [];
    state.tasks = p.tasks || [];
    state.inventory = p.inventory || [];
  } catch (_) {}
}

async function loadFromServer() {
  try {
    const r = await fetch("/api/data");
    if (!r.ok) return;
    const d = (await r.json()).data || {};
    state.expenses = Array.isArray(d.expenses) ? d.expenses : [];
    state.habits = Array.isArray(d.habits) ? d.habits : [];
    state.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    state.inventory = Array.isArray(d.inventory) ? d.inventory : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: state }) });
    } catch (_) {}
  }, 250);
}

async function init() {
  await loadFromServer();
  renderNav();
  renderAllPanels();
  renderDashboard();
  setupQuickAdd();
  setupExportImport();
  setupReminders();
  setupOnboarding();
}

function afterChange() {
  saveLocal();
  renderAllPanels();
  renderDashboard();
}

function renderNav() {
  const nav = document.getElementById("tracker-nav");
  nav.innerHTML = "";
  trackers.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "nav-btn" + (t.id === activeTracker ? " active" : "");
    btn.textContent = t.label;
    btn.addEventListener("click", () => { activeTracker = t.id; renderNav(); renderAllPanels(); });
    nav.appendChild(btn);
  });
}

function setText(id, value) { const n = document.getElementById(id); if (n) n.textContent = value; }
function renderAllPanels() {
  renderExpenses();
  renderHabits();
  renderTasks();
  renderInventory();
  trackers.forEach(({ id }) => document.getElementById(`panel-${id}`)?.classList.toggle("active", id === activeTracker));
}

function renderExpenses() {
  const p = document.getElementById("panel-expenses");
  const f = filters.expenses;
  p.innerHTML = `
    <h2>Expense Tracker</h2>
    <div class="tool-row">
      <input type="search" id="expense-search" placeholder="Search" value="${esc(f.search)}" />
      <select id="expense-category-filter"><option value="all">All Categories</option>${Object.entries(expenseCategories).map(([k,v]) => `<option value="${k}"${f.category===k?" selected":""}>${v}</option>`).join("")}</select>
      <select id="expense-sort"><option value="newest"${f.sort==="newest"?" selected":""}>Newest</option><option value="amount_desc"${f.sort==="amount_desc"?" selected":""}>Amount High-Low</option><option value="amount_asc"${f.sort==="amount_asc"?" selected":""}>Amount Low-High</option></select>
    </div>
    <div class="layout">
      <div class="form-block"><form id="expense-form"><label>Date<input name="date" type="date" required /></label><label>Category<select name="category" required><option value="">Choose</option>${options(expenseCategories)}</select></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required /></label><label>Note<textarea name="note" rows="2"></textarea></label><button class="primary" type="submit">Add Expense</button></form></div>
      <div class="list-block" id="expense-list"></div>
    </div>`;

  p.querySelector("#expense-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const x = e.target;
    state.expenses.unshift({ id: uid(), date: x.date.value, category: x.category.value, amount: Number(x.amount.value), note: x.note.value.trim() });
    afterChange();
  });

  p.querySelector("#expense-search").addEventListener("input", (e) => { f.search = e.target.value; renderExpenses(); });
  p.querySelector("#expense-category-filter").addEventListener("change", (e) => { f.category = e.target.value; renderExpenses(); });
  p.querySelector("#expense-sort").addEventListener("change", (e) => { f.sort = e.target.value; renderExpenses(); });

  let rows = state.expenses.filter((r) => (f.category === "all" || r.category === f.category) && (!f.search || contains(expenseCategories[r.category] || r.category, f.search.toLowerCase()) || contains(r.note, f.search.toLowerCase())));
  if (f.sort === "amount_desc") rows = rows.sort((a,b) => Number(b.amount)-Number(a.amount));
  else if (f.sort === "amount_asc") rows = rows.sort((a,b) => Number(a.amount)-Number(b.amount));
  else rows = rows.sort((a,b) => String(b.date).localeCompare(String(a.date)));

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  p.querySelector("h2").insertAdjacentHTML("afterend", `<div class="stat-row"><div class="stat"><span>Filtered Total</span><strong>$${total.toFixed(2)}</strong></div></div>`);
  const list = p.querySelector("#expense-list");
  if (!rows.length) { list.innerHTML = '<div class="empty">No matching expenses.</div>'; return; }
  rows.forEach((r) => {
    const card = createCard(expenseCategories[r.category] || r.category || "Unspecified", `${r.date} | $${Number(r.amount).toFixed(2)}`, r.note || "No note");
    addAction(card, "Delete", "btn-danger", () => { state.expenses = state.expenses.filter((x) => x.id !== r.id); afterChange(); });
    list.appendChild(card);
  });
}

function renderHabits() {
  const p = document.getElementById("panel-habits");
  const f = filters.habits;
  p.innerHTML = `
    <h2>Habit Tracker</h2>
    <div class="tool-row">
      <input type="search" id="habit-search" placeholder="Search" value="${esc(f.search)}" />
      <select id="habit-frequency-filter"><option value="all">All Frequencies</option><option value="Daily"${f.frequency==="Daily"?" selected":""}>Daily</option><option value="Weekly"${f.frequency==="Weekly"?" selected":""}>Weekly</option></select>
      <select id="habit-sort"><option value="az"${f.sort==="az"?" selected":""}>A-Z</option><option value="streak"${f.sort==="streak"?" selected":""}>Highest Streak</option></select>
    </div>
    <div class="layout">
      <div class="form-block"><form id="habit-form"><label>Habit<select name="name" required><option value="">Choose</option>${options(habitDictionary)}</select></label><label>Frequency<select name="frequency"><option value="Daily">Daily</option><option value="Weekly">Weekly</option></select></label><button class="primary" type="submit">Add Habit</button></form></div>
      <div class="list-block" id="habit-list"></div>
    </div>`;

  p.querySelector("#habit-form").addEventListener("submit", (e) => { e.preventDefault(); const x=e.target; state.habits.unshift({ id: uid(), name: x.name.value, frequency: x.frequency.value, completions: [] }); afterChange(); });
  p.querySelector("#habit-search").addEventListener("input", (e) => { f.search = e.target.value; renderHabits(); });
  p.querySelector("#habit-frequency-filter").addEventListener("change", (e) => { f.frequency = e.target.value; renderHabits(); });
  p.querySelector("#habit-sort").addEventListener("change", (e) => { f.sort = e.target.value; renderHabits(); });

  let rows = state.habits.filter((r) => (f.frequency === "all" || r.frequency === f.frequency) && (!f.search || contains(habitDictionary[r.name] || r.name, f.search.toLowerCase())));
  if (f.sort === "streak") rows = rows.sort((a,b) => calculateStreak(b.completions) - calculateStreak(a.completions));
  else rows = rows.sort((a,b) => String(habitDictionary[a.name]||a.name).localeCompare(String(habitDictionary[b.name]||b.name)));

  const today = todayISO();
  const list = p.querySelector("#habit-list");
  if (!rows.length) { list.innerHTML = '<div class="empty">No matching habits.</div>'; return; }
  rows.forEach((r) => {
    const done = (r.completions || []).includes(today);
    const card = createCard(habitDictionary[r.name] || r.name || "Unspecified", `${r.frequency} | Streak: ${calculateStreak(r.completions)} day(s)`, done ? "Marked done today." : "Not done today.");
    addAction(card, done ? "Undo Today" : "Mark Today", "btn-muted", () => { if (done) r.completions = r.completions.filter((d) => d !== today); else r.completions.push(today); afterChange(); });
    addAction(card, "Delete", "btn-danger", () => { state.habits = state.habits.filter((x) => x.id !== r.id); afterChange(); });
    list.appendChild(card);
  });
}

function renderTasks() {
  const p = document.getElementById("panel-tasks");
  const f = filters.tasks;
  p.innerHTML = `
    <h2>Task Tracker</h2>
    <div class="tool-row">
      <input type="search" id="task-search" placeholder="Search" value="${esc(f.search)}" />
      <select id="task-status-filter"><option value="all">All Status</option><option value="pending"${f.status==="pending"?" selected":""}>Pending</option><option value="done"${f.status==="done"?" selected":""}>Done</option></select>
      <select id="task-priority-filter"><option value="all">All Priority</option><option value="Low"${f.priority==="Low"?" selected":""}>Low</option><option value="Medium"${f.priority==="Medium"?" selected":""}>Medium</option><option value="High"${f.priority==="High"?" selected":""}>High</option></select>
      <select id="task-sort"><option value="due"${f.sort==="due"?" selected":""}>Due Date</option><option value="priority"${f.sort==="priority"?" selected":""}>Priority</option></select>
    </div>
    <div class="layout">
      <div class="form-block"><form id="task-form"><label>Task<select name="title" required><option value="">Choose</option>${options(taskDictionary)}</select></label><label>Due Date<input name="dueDate" type="date" /></label><label>Priority<select name="priority"><option>Low</option><option selected>Medium</option><option>High</option></select></label><button class="primary" type="submit">Add Task</button></form></div>
      <div class="list-block" id="task-list"></div>
    </div>`;
  p.querySelector("#task-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const x = e.target;
    state.tasks.unshift({ id: uid(), title: x.title.value, dueDate: x.dueDate.value || "No due date", priority: x.priority.value, done: false });
    afterChange();
  });
  p.querySelector("#task-search").addEventListener("input", (e) => { f.search = e.target.value; renderTasks(); });
  p.querySelector("#task-status-filter").addEventListener("change", (e) => { f.status = e.target.value; renderTasks(); });
  p.querySelector("#task-priority-filter").addEventListener("change", (e) => { f.priority = e.target.value; renderTasks(); });
  p.querySelector("#task-sort").addEventListener("change", (e) => { f.sort = e.target.value; renderTasks(); });

  let rows = state.tasks.filter((r) => {
    const textMatch = !f.search || contains(taskDictionary[r.title] || r.title, f.search.toLowerCase());
    const statusMatch = f.status === "all" || (f.status === "done" ? r.done : !r.done);
    const priorityMatch = f.priority === "all" || r.priority === f.priority;
    return textMatch && statusMatch && priorityMatch;
  });

  if (f.sort === "priority") {
    const rank = { High: 3, Medium: 2, Low: 1 };
    rows = rows.sort((a,b) => (rank[b.priority]||0) - (rank[a.priority]||0));
  } else {
    rows = rows.sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  }

  const doneCount = rows.filter((r) => r.done).length;
  p.querySelector("h2").insertAdjacentHTML("afterend", `<div class="stat-row"><div class="stat"><span>Filtered Completed</span><strong>${doneCount}/${rows.length}</strong></div></div>`);
  const list = p.querySelector("#task-list");
  if (!rows.length) { list.innerHTML = '<div class="empty">No matching tasks.</div>'; return; }
  rows.forEach((r) => {
    const card = createCard(taskDictionary[r.title] || r.title || "Unspecified", `${r.priority} | Due: ${r.dueDate}`, r.done ? "Status: Done" : "Status: Pending");
    card.dataset.taskId = r.id;
    addAction(card, r.done ? "Mark Pending" : "Mark Done", "btn-muted", () => { r.done = !r.done; afterChange(); });
    addAction(card, "Delete", "btn-danger", () => { state.tasks = state.tasks.filter((x) => x.id !== r.id); afterChange(); });
    list.appendChild(card);
  });
}

function renderInventory() {
  const p = document.getElementById("panel-inventory");
  const f = filters.inventory;
  p.innerHTML = `
    <h2>Inventory Tracker</h2>
    <div class="tool-row">
      <input type="search" id="inventory-search" placeholder="Search" value="${esc(f.search)}" />
      <select id="inventory-location-filter"><option value="all">All Locations</option>${Object.entries(inventoryLocations).map(([k,v]) => `<option value="${k}"${f.location===k?" selected":""}>${v}</option>`).join("")}</select>
      <select id="inventory-stock-filter"><option value="all">All Stock</option><option value="low"${f.stock==="low"?" selected":""}>Low Stock</option><option value="ok"${f.stock==="ok"?" selected":""}>Sufficient</option></select>
      <select id="inventory-sort"><option value="az"${f.sort==="az"?" selected":""}>A-Z</option><option value="qty_desc"${f.sort==="qty_desc"?" selected":""}>Quantity High-Low</option><option value="qty_asc"${f.sort==="qty_asc"?" selected":""}>Quantity Low-High</option></select>
    </div>
    <div class="layout">
      <div class="form-block"><form id="inventory-form"><label>Item<select name="item" required><option value="">Choose</option>${options(inventoryItems)}</select></label><label>Quantity<input name="quantity" type="number" min="0" required /></label><label>Low Stock Alert<input name="lowStock" type="number" min="0" value="5" required /></label><label>Location<select name="location" required><option value="">Choose</option>${options(inventoryLocations)}</select></label><button class="primary" type="submit">Add Item</button></form></div>
      <div class="list-block" id="inventory-list"></div>
    </div>`;

  p.querySelector("#inventory-form").addEventListener("submit", (e) => { e.preventDefault(); const x=e.target; state.inventory.unshift({ id: uid(), item: x.item.value, quantity: Number(x.quantity.value), lowStock: Number(x.lowStock.value), location: x.location.value }); afterChange(); });
  p.querySelector("#inventory-search").addEventListener("input", (e) => { f.search = e.target.value; renderInventory(); });
  p.querySelector("#inventory-location-filter").addEventListener("change", (e) => { f.location = e.target.value; renderInventory(); });
  p.querySelector("#inventory-stock-filter").addEventListener("change", (e) => { f.stock = e.target.value; renderInventory(); });
  p.querySelector("#inventory-sort").addEventListener("change", (e) => { f.sort = e.target.value; renderInventory(); });

  let rows = state.inventory.filter((r) => {
    const textMatch = !f.search || contains(inventoryItems[r.item] || r.item, f.search.toLowerCase());
    const locMatch = f.location === "all" || r.location === f.location;
    const low = Number(r.quantity) <= Number(r.lowStock);
    const stockMatch = f.stock === "all" || (f.stock === "low" ? low : !low);
    return textMatch && locMatch && stockMatch;
  });
  if (f.sort === "qty_desc") rows = rows.sort((a,b) => Number(b.quantity)-Number(a.quantity));
  else if (f.sort === "qty_asc") rows = rows.sort((a,b) => Number(a.quantity)-Number(b.quantity));
  else rows = rows.sort((a,b) => String(inventoryItems[a.item]||a.item).localeCompare(String(inventoryItems[b.item]||b.item)));

  const lowCount = rows.filter((r) => Number(r.quantity) <= Number(r.lowStock)).length;
  p.querySelector("h2").insertAdjacentHTML("afterend", `<div class="stat-row"><div class="stat"><span>Filtered Low Stock</span><strong>${lowCount}</strong></div></div>`);
  const list = p.querySelector("#inventory-list");
  if (!rows.length) { list.innerHTML = '<div class="empty">No matching inventory items.</div>'; return; }
  rows.forEach((r) => {
    const low = Number(r.quantity) <= Number(r.lowStock);
    const card = createCard(inventoryItems[r.item] || r.item || "Unspecified", `Qty: ${r.quantity} | Low alert: ${r.lowStock}`, `Location: ${inventoryLocations[r.location] || r.location || "Unspecified"}${low ? " | Low stock" : ""}`);
    addAction(card, "+1 Qty", "btn-muted", () => { r.quantity += 1; afterChange(); });
    addAction(card, "-1 Qty", "btn-muted", () => { r.quantity = Math.max(0, r.quantity - 1); afterChange(); });
    addAction(card, "Delete", "btn-danger", () => { state.inventory = state.inventory.filter((x) => x.id !== r.id); afterChange(); });
    list.appendChild(card);
  });
}

function renderDashboard() {
  const month = todayISO().slice(0, 7);
  const expenses = state.expenses.filter((e) => String(e.date || "").startsWith(month)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const pending = state.tasks.filter((t) => !t.done).length;
  const habitsToday = state.habits.filter((h) => (h.completions || []).includes(todayISO())).length;
  const lowStock = state.inventory.filter((i) => Number(i.quantity) <= Number(i.lowStock)).length;
  setText("sum-expenses", `$${expenses.toFixed(2)}`);
  setText("pending-tasks", String(pending));
  setText("habits-today", String(habitsToday));
  setText("low-stock", String(lowStock));
  renderExpenseChart();
  renderCalendar();
  renderReminderPanels();
}

function getTaskReminderBuckets() {
  const today = todayISO();
  const pendingWithDate = state.tasks.filter((t) => !t.done && t.dueDate && t.dueDate !== "No due date");
  const dueToday = pendingWithDate.filter((t) => t.dueDate === today);
  const overdue = pendingWithDate.filter((t) => t.dueDate < today);
  overdue.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  dueToday.sort((a, b) => String(a.priority).localeCompare(String(b.priority)));
  return { dueToday, overdue };
}

function reminderItemHtml(task, overdue = false) {
  const title = esc(taskDictionary[task.title] || task.title || "Unspecified task");
  const due = esc(task.dueDate || "No due date");
  const priority = esc(task.priority || "Medium");
  const taskId = esc(task.id || "");
  return `<button type="button" class="reminder-item reminder-link${overdue ? " overdue" : ""}" data-task-id="${taskId}"><strong>${title}</strong><p class="reminder-meta">Due: ${due} | Priority: ${priority}</p></button>`;
}

function jumpToTask(taskId) {
  if (!taskId) return;
  activeTracker = "tasks";
  highlightTaskId = taskId;
  renderNav();
  renderAllPanels();

  const selector = `#panel-tasks [data-task-id="${taskId}"]`;
  const card = document.querySelector(selector);
  if (!card) return;
  card.classList.add("task-highlight");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => {
    card.classList.remove("task-highlight");
    if (highlightTaskId === taskId) highlightTaskId = "";
  }, 1800);
}

function renderReminderPanels() {
  const dueList = document.getElementById("due-today-list");
  const overdueList = document.getElementById("overdue-list");
  if (!dueList || !overdueList) return;

  const { dueToday, overdue } = getTaskReminderBuckets();
  setText("due-today-count", String(dueToday.length));
  setText("overdue-count", String(overdue.length));

  dueList.innerHTML = dueToday.length ? dueToday.map((task) => reminderItemHtml(task)).join("") : '<p class="reminder-empty">No tasks due today.</p>';
  overdueList.innerHTML = overdue.length ? overdue.map((task) => reminderItemHtml(task, true)).join("") : '<p class="reminder-empty">No overdue tasks.</p>';

  document.querySelectorAll(".reminder-link").forEach((button) => {
    button.addEventListener("click", () => {
      jumpToTask(button.getAttribute("data-task-id") || "");
    });
  });

  if (highlightTaskId) {
    const activeCard = document.querySelector(`#panel-tasks [data-task-id="${highlightTaskId}"]`);
    if (activeCard) activeCard.classList.add("task-highlight");
  }
}

function renderExpenseChart() {
  const canvas = document.getElementById("expense-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, total: state.expenses.filter((e) => e.date === key).reduce((s, e) => s + Number(e.amount || 0), 0) });
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#eff5fb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const max = Math.max(1, ...days.map((d) => d.total));
  const pad = 30;
  const barW = (canvas.width - pad * 2) / days.length - 10;
  days.forEach((d, i) => {
    const x = pad + i * (barW + 10);
    const h = ((canvas.height - 70) * d.total) / max;
    ctx.fillStyle = "#0f766e";
    ctx.fillRect(x, canvas.height - h - 30, barW, h);
    ctx.fillStyle = "#1f2d3d";
    ctx.font = "12px Space Grotesk";
    ctx.fillText(d.key.slice(5), x, canvas.height - 10);
  });
}
function renderCalendar() {
  const root = document.getElementById("calendar-grid");
  if (!root) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const offset = first.getDay();
  const cells = Math.ceil((offset + last.getDate()) / 7) * 7;

  const dueMap = {};
  state.tasks.forEach((t) => { if (t.dueDate && t.dueDate !== "No due date") dueMap[t.dueDate] = (dueMap[t.dueDate] || 0) + 1; });
  const habitMap = {};
  state.habits.forEach((h) => (h.completions || []).forEach((d) => { habitMap[d] = (habitMap[d] || 0) + 1; }));

  let html = `<div class="calendar-head">${now.toLocaleString("default", { month: "long" })} ${year}</div>`;
  html += "<div class='calendar-week'>Sun</div><div class='calendar-week'>Mon</div><div class='calendar-week'>Tue</div><div class='calendar-week'>Wed</div><div class='calendar-week'>Thu</div><div class='calendar-week'>Fri</div><div class='calendar-week'>Sat</div>";

  for (let i = 0; i < cells; i += 1) {
    const day = i - offset + 1;
    if (day < 1 || day > last.getDate()) {
      html += "<div class='calendar-cell muted'></div>";
      continue;
    }
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    html += `<div class="calendar-cell"><strong>${day}</strong><small>T:${dueMap[key] || 0} H:${habitMap[key] || 0}</small></div>`;
  }

  root.innerHTML = html;
}

function setupQuickAdd() {
  const modal = document.getElementById("quick-add-modal");
  const form = document.getElementById("quick-add-form");
  const openBtn = document.getElementById("quick-add-open");
  const closeBtn = document.getElementById("quick-add-close");

  const renderFields = () => {
    const fields = form.querySelector("#quick-fields");
    if (quickAddType === "expenses") fields.innerHTML = `<label>Date<input name="date" type="date" value="${todayISO()}" required /></label><label>Category<select name="category" required><option value="">Choose</option>${options(expenseCategories)}</select></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required /></label>`;
    else if (quickAddType === "habits") fields.innerHTML = `<label>Habit<select name="name" required><option value="">Choose</option>${options(habitDictionary)}</select></label><label>Frequency<select name="frequency"><option value="Daily">Daily</option><option value="Weekly">Weekly</option></select></label>`;
    else if (quickAddType === "tasks") fields.innerHTML = `<label>Task<select name="title" required><option value="">Choose</option>${options(taskDictionary)}</select></label><label>Due Date<input name="dueDate" type="date" /></label><label>Priority<select name="priority"><option>Low</option><option selected>Medium</option><option>High</option></select></label>`;
    else fields.innerHTML = `<label>Item<select name="item" required><option value="">Choose</option>${options(inventoryItems)}</select></label><label>Quantity<input name="quantity" type="number" min="0" value="1" required /></label><label>Low Alert<input name="lowStock" type="number" min="0" value="5" required /></label><label>Location<select name="location" required><option value="">Choose</option>${options(inventoryLocations)}</select></label>`;
  };

  const open = () => {
    modal.classList.remove("hidden");
    form.innerHTML = `<label>Tracker Type<select name="type" id="quick-type">${trackers.map((t) => `<option value="${t.id}"${t.id===quickAddType?" selected":""}>${t.label}</option>`).join("")}</select></label><div id="quick-fields"></div><button class="primary" type="submit">Add Now</button>`;
    form.querySelector("#quick-type").addEventListener("change", (e) => { quickAddType = e.target.value; renderFields(); });
    renderFields();
  };

  const close = () => modal.classList.add("hidden");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const x = new FormData(form);
    const type = String(x.get("type") || quickAddType);
    if (type === "expenses") state.expenses.unshift({ id: uid(), date: String(x.get("date") || todayISO()), category: String(x.get("category") || ""), amount: Number(x.get("amount") || 0), note: "Quick add" });
    else if (type === "habits") state.habits.unshift({ id: uid(), name: String(x.get("name") || ""), frequency: String(x.get("frequency") || "Daily"), completions: [] });
    else if (type === "tasks") state.tasks.unshift({ id: uid(), title: String(x.get("title") || ""), dueDate: String(x.get("dueDate") || "No due date") || "No due date", priority: String(x.get("priority") || "Medium"), done: false });
    else state.inventory.unshift({ id: uid(), item: String(x.get("item") || ""), quantity: Number(x.get("quantity") || 0), lowStock: Number(x.get("lowStock") || 5), location: String(x.get("location") || "") });
    close();
    afterChange();
  });

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  modal?.addEventListener("click", (e) => { if (e.target === modal) close(); });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); }
    if (e.key === "Escape") close();
  });
}

function setupExportImport() {
  document.getElementById("export-json")?.addEventListener("click", () => {
    download("multi-tracker-export.json", JSON.stringify(state, null, 2), "application/json");
  });
  document.getElementById("export-csv")?.addEventListener("click", () => {
    const lines = ["type,id,name_or_title,meta_1,meta_2,meta_3"];
    state.expenses.forEach((e) => lines.push(`expense,${csv(e.id)},${csv(expenseCategories[e.category]||e.category)},${csv(e.date)},${csv(e.amount)},${csv(e.note||"")}`));
    state.habits.forEach((h) => lines.push(`habit,${csv(h.id)},${csv(habitDictionary[h.name]||h.name)},${csv(h.frequency)},${csv((h.completions||[]).join("|"))},`));
    state.tasks.forEach((t) => lines.push(`task,${csv(t.id)},${csv(taskDictionary[t.title]||t.title)},${csv(t.dueDate)},${csv(t.priority)},${csv(t.done)}`));
    state.inventory.forEach((i) => lines.push(`inventory,${csv(i.id)},${csv(inventoryItems[i.item]||i.item)},${csv(i.quantity)},${csv(i.lowStock)},${csv(inventoryLocations[i.location]||i.location)}`));
    download("multi-tracker-export.csv", lines.join("\n"), "text/csv");
  });
  document.getElementById("import-json")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      state.expenses = Array.isArray(p.expenses) ? p.expenses : [];
      state.habits = Array.isArray(p.habits) ? p.habits : [];
      state.tasks = Array.isArray(p.tasks) ? p.tasks : [];
      state.inventory = Array.isArray(p.inventory) ? p.inventory : [];
      afterChange();
    } catch (_) { alert("Invalid JSON file."); }
    e.target.value = "";
  });
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setupReminders() {
  document.getElementById("enable-reminders")?.addEventListener("click", async () => {
    if (!('Notification' in window)) return alert("Browser notifications not supported.");
    const result = await Notification.requestPermission();
    if (result !== "granted") alert("Permission not granted.");
  });

  const check = () => {
    const alerts = [];
    const { dueToday, overdue } = getTaskReminderBuckets();
    if (dueToday.length) alerts.push(`${dueToday.length} task(s) due today`);
    if (overdue.length) alerts.push(`${overdue.length} overdue task(s)`);
    const low = state.inventory.filter((i) => Number(i.quantity) <= Number(i.lowStock));
    if (low.length) alerts.push(`${low.length} low-stock item(s)`);
    const today = todayISO();
    const missed = state.habits.filter((h) => h.frequency === "Daily" && !(h.completions || []).includes(today));
    if (missed.length) alerts.push(`${missed.length} daily habit(s) not done`);
    const fp = alerts.join("|");
    if (!fp || fp === lastReminderFingerprint) return;
    lastReminderFingerprint = fp;
    if ('Notification' in window && Notification.permission === "granted") new Notification("Tracker Reminder", { body: alerts.join(" | ") });
    renderReminderPanels();
  };

  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(check, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  check();
}

function setupOnboarding() {
  const modal = document.getElementById("onboarding-modal");
  if (!modal) return;
  if (!localStorage.getItem(ONBOARDING_KEY)) modal.classList.remove("hidden");
  modal.querySelectorAll("[data-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chosen = templates[btn.getAttribute("data-template")] || templates.blank;
      state.expenses = chosen.expenses.map(clone);
      state.habits = chosen.habits.map(clone);
      state.tasks = chosen.tasks.map(clone);
      state.inventory = chosen.inventory.map(clone);
      localStorage.setItem(ONBOARDING_KEY, "1");
      modal.classList.add("hidden");
      afterChange();
    });
  });
}

function createCard(title, meta, body) {
  const t = document.getElementById("card-template");
  const node = t.content.cloneNode(true).querySelector(".card");
  node.querySelector("h3").textContent = title;
  node.querySelector(".meta").textContent = meta;
  node.querySelector("p").textContent = body;
  return node;
}

function addAction(card, label, cls, handler) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", handler);
  card.querySelector(".actions").appendChild(btn);
}

function calculateStreak(completions) {
  if (!Array.isArray(completions) || !completions.length) return 0;
  const set = new Set(completions);
  const d = new Date();
  let streak = 0;
  while (true) {
    const k = d.toISOString().slice(0, 10);
    if (!set.has(k)) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
