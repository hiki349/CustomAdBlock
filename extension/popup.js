const ENABLED_APP_KEY = "enabled-app-key";
const STORAGE_KEYS = {
  visitedDomains: "visited-domains",
  blockedDomains: "blocked-domains-count",
  whitelistDomains: "whitelist-count",
  whitelist: "whitelist",
};

const elements = {
  statusText: document.getElementById("statusText"),
  statusChangeBtn: document.getElementById("statusChangeBtn"),
  visitedDomains: document.getElementById("visitedDomains"),
  blockedDomains: document.getElementById("blockedDomains"),
  whitelistDomains: document.getElementById("whitelistDomains"),
  addToWhitelistBtn: document.getElementById("addToWhitelist"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await initializeUI();
  setupEventListeners();
  observeStorageChanges();
});

async function initializeUI() {
  elements.statusText.innerText = (await getStorageValue(ENABLED_APP_KEY))
    ? "Active"
    : "Disabled";
  elements.visitedDomains.innerText = await getVisitedDomainsCount();
  elements.blockedDomains.innerText = await getStorageValue(
    STORAGE_KEYS.blockedDomains,
    0
  );
  elements.whitelistDomains.innerText = await getStorageValue(
    STORAGE_KEYS.whitelistDomains,
    0
  );
  updateWhitelistButtonUI();
}

function setupEventListeners() {
  elements.statusChangeBtn.addEventListener("click", toggleAppStatus);
  elements.addToWhitelistBtn.addEventListener("click", handleWhitelistToggle);
}

function observeStorageChanges() {
  chrome.storage.local.onChanged.addListener(async (changes) => {
    if (changes[STORAGE_KEYS.visitedDomains]) {
      elements.visitedDomains.innerText = Object.keys(
        changes[STORAGE_KEYS.visitedDomains].newValue || {}
      ).length;
    }
    if (changes[STORAGE_KEYS.blockedDomains]) {
      elements.blockedDomains.innerText =
        changes[STORAGE_KEYS.blockedDomains].newValue;
    }
    if (changes[STORAGE_KEYS.whitelistDomains]) {
      elements.whitelistDomains.innerText =
        changes[STORAGE_KEYS.whitelistDomains].newValue;
    }
  });
}

async function toggleAppStatus() {
  const currentStatus = await getStorageValue(ENABLED_APP_KEY, false);
  await chrome.storage.local.set({ [ENABLED_APP_KEY]: !currentStatus });
  elements.statusText.innerText = !currentStatus ? "Active" : "Disabled";
}

async function handleWhitelistToggle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = new URL(tab.url);
  const whitelist = await getStorageValue(STORAGE_KEYS.whitelist, []);
  const isExist = whitelist.some((item) => item?.domain === url.hostname);

  const updatedWhitelist = isExist
    ? whitelist.filter((item) => item?.domain !== url.hostname)
    : [...whitelist, { id: 500_000 + whitelist.length, domain: url.hostname }];

  await chrome.storage.local.set({
    [STORAGE_KEYS.whitelist]: updatedWhitelist,
  });
  chrome.tabs.reload(tab.id);
  window.close();
}

async function updateWhitelistButtonUI() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = new URL(tab.url);
  const whitelist = await getStorageValue(STORAGE_KEYS.whitelist, []);
  const isBlocked = whitelist.some((item) => item?.domain === url.hostname);

  elements.addToWhitelistBtn.classList.toggle(
    "none",
    url.hostname === "newtab"
  );
  elements.addToWhitelistBtn.classList.toggle("button-danger", isBlocked);
  elements.addToWhitelistBtn.innerText = isBlocked
    ? "Remove current domain from whitelist"
    : "Add current domain to whitelist";
}

async function getStorageValue(key, defaultValue = null) {
  const storageData = await chrome.storage.local.get([key]);
  return storageData[key] ?? defaultValue;
}

async function getVisitedDomainsCount() {
  const domains = await getStorageValue(STORAGE_KEYS.visitedDomains, {});
  return Object.keys(domains).length;
}
