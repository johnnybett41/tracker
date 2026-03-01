const sections = [
  { key: "expenseCategories", label: "Expense Categories" },
  { key: "habitDictionary", label: "Habit Dictionary" },
  { key: "taskDictionary", label: "Task Dictionary" },
  { key: "inventoryItems", label: "Inventory Items" },
  { key: "inventoryLocations", label: "Inventory Locations" }
];

let dictionaries = window.TrackerDictionaries.loadDictionaries();

function keyFromLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureSession() {
  return fetch("/api/session")
    .then((r) => r.json())
    .then((data) => {
      if (!data.authenticated) window.location.href = "login.html";
    })
    .catch(() => {
      window.location.href = "login.html";
    });
}

function render() {
  const root = document.getElementById("dictionary-sections");
  root.innerHTML = "";

  sections.forEach((section) => {
    const card = document.createElement("article");
    card.className = "admin-card";

    const rows = Object.entries(dictionaries[section.key] || {})
      .map(
        ([key, label]) => `
          <div class="dict-row" data-section="${section.key}">
            <input data-role="key" value="${escapeHtml(key)}" placeholder="key_name" />
            <input data-role="label" value="${escapeHtml(label)}" placeholder="Display Label" />
            <button type="button" class="btn-danger" data-action="remove">Remove</button>
          </div>
        `
      )
      .join("");

    card.innerHTML = `
      <h3>${section.label}</h3>
      <div class="dict-rows" id="rows-${section.key}">${rows}</div>
      <button class="btn-muted" type="button" data-action="add" data-section="${section.key}">+ Add Option</button>
    `;

    root.appendChild(card);
  });

  bindActions();
}

function bindActions() {
  document.querySelectorAll('[data-action="add"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.getAttribute("data-section");
      const rows = document.getElementById(`rows-${section}`);
      const row = document.createElement("div");
      row.className = "dict-row";
      row.innerHTML = `
        <input data-role="key" placeholder="key_name" />
        <input data-role="label" placeholder="Display Label" />
        <button type="button" class="btn-danger" data-action="remove">Remove</button>
      `;
      rows.appendChild(row);
      row.querySelector('[data-action="remove"]').addEventListener("click", () => row.remove());
    });
  });

  document.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".dict-row").remove();
    });
  });
}

function readSection(sectionKey) {
  const rows = document.querySelectorAll(`#rows-${sectionKey} .dict-row`);
  const out = {};

  rows.forEach((row) => {
    const keyInput = row.querySelector('[data-role="key"]');
    const labelInput = row.querySelector('[data-role="label"]');

    const rawLabel = String(labelInput.value || "").trim();
    if (!rawLabel) return;

    const rawKey = String(keyInput.value || "").trim();
    const key = rawKey || keyFromLabel(rawLabel);
    if (!key) return;

    out[key] = rawLabel;
  });

  return out;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

document.getElementById("save-dictionaries").addEventListener("click", () => {
  const updated = {};
  sections.forEach((section) => {
    updated[section.key] = readSection(section.key);
  });

  window.TrackerDictionaries.saveDictionaries(updated);
  dictionaries = window.TrackerDictionaries.loadDictionaries();
  render();

  const status = document.getElementById("admin-status");
  status.textContent = "Saved. Open Home to see updated dropdowns.";
});

document.getElementById("reset-dictionaries").addEventListener("click", () => {
  window.TrackerDictionaries.saveDictionaries(window.TrackerDictionaries.DEFAULT_DICTIONARIES);
  dictionaries = window.TrackerDictionaries.loadDictionaries();
  render();

  const status = document.getElementById("admin-status");
  status.textContent = "Reset to default dictionaries.";
});

document.getElementById("logout-link").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch (_) {}
  window.location.href = "login.html";
});

ensureSession().then(render);
