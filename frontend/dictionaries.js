(function () {
  const STORAGE_KEY = "multi-tracker-dictionaries-v1";

  const DEFAULT_DICTIONARIES = {
    expenseCategories: {
      food: "Food",
      transport: "Transport",
      rent: "Rent",
      utilities: "Utilities",
      health: "Health",
      education: "Education",
      shopping: "Shopping",
      entertainment: "Entertainment",
      savings: "Savings",
      other: "Other"
    },
    habitDictionary: {
      workout: "Workout",
      reading: "Reading",
      meditation: "Meditation",
      journaling: "Journaling",
      hydration: "Drink Water",
      sleep_early: "Sleep Early",
      study: "Study",
      prayer: "Prayer"
    },
    taskDictionary: {
      report: "Finish Report",
      meeting: "Team Meeting",
      follow_up: "Client Follow-up",
      budgeting: "Weekly Budget Review",
      planning: "Plan Next Week",
      shopping: "Buy Supplies",
      calls: "Important Calls",
      personal: "Personal Errands"
    },
    inventoryItems: {
      notebook: "Notebook",
      pen: "Pen",
      paper: "Paper Ream",
      stapler: "Stapler",
      folder: "File Folder",
      marker: "Marker",
      toner: "Printer Toner",
      sanitizer: "Sanitizer"
    },
    inventoryLocations: {
      storeroom_a: "Storeroom A",
      storeroom_b: "Storeroom B",
      storefront: "Storefront",
      warehouse: "Warehouse",
      office: "Office",
      kitchen: "Kitchen",
      delivery_van: "Delivery Van"
    }
  };

  function sanitizeDictionary(input) {
    const clean = {};
    if (!input || typeof input !== "object") return clean;

    Object.entries(input).forEach(([rawKey, rawLabel]) => {
      const key = String(rawKey || "").trim();
      const label = String(rawLabel || "").trim();
      if (!key || !label) return;
      clean[key] = label;
    });

    return clean;
  }

  function loadDictionaries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DICTIONARIES));

      const parsed = JSON.parse(raw);
      return {
        expenseCategories: { ...DEFAULT_DICTIONARIES.expenseCategories, ...sanitizeDictionary(parsed.expenseCategories) },
        habitDictionary: { ...DEFAULT_DICTIONARIES.habitDictionary, ...sanitizeDictionary(parsed.habitDictionary) },
        taskDictionary: { ...DEFAULT_DICTIONARIES.taskDictionary, ...sanitizeDictionary(parsed.taskDictionary) },
        inventoryItems: { ...DEFAULT_DICTIONARIES.inventoryItems, ...sanitizeDictionary(parsed.inventoryItems) },
        inventoryLocations: { ...DEFAULT_DICTIONARIES.inventoryLocations, ...sanitizeDictionary(parsed.inventoryLocations) }
      };
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_DICTIONARIES));
    }
  }

  function saveDictionaries(dictionaries) {
    const payload = {
      expenseCategories: sanitizeDictionary(dictionaries.expenseCategories),
      habitDictionary: sanitizeDictionary(dictionaries.habitDictionary),
      taskDictionary: sanitizeDictionary(dictionaries.taskDictionary),
      inventoryItems: sanitizeDictionary(dictionaries.inventoryItems),
      inventoryLocations: sanitizeDictionary(dictionaries.inventoryLocations)
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  window.TrackerDictionaries = {
    STORAGE_KEY,
    DEFAULT_DICTIONARIES,
    loadDictionaries,
    saveDictionaries
  };
})();
