const ENABLED_APP_KEY = "enabled-app-key";
const EXCLUDED_DOMAINS_STORAGE_KEY = "excluded-domains-storage-key";
const STORAGE_KEYS = {
  blockedDomains: "blocked-domains-count",
};

const elements = {
  statusToggle: document.getElementById("statusToggle"),
  blockedDomains: document.getElementById("blockedDomains"),
  changeDomainStatusBtn: document.getElementById("changeDomainStatus"),
  currentDomain: document.getElementById("currentDomain"),
  footer: document.getElementById("footer"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await initializeUI();
  setupEventListeners();
  observeStorageChanges();
});

async function initializeUI() {
  const isEnabled = await getStorageValue(ENABLED_APP_KEY, false);
  elements.statusToggle.checked = isEnabled;
  footer.innerText = `v${chrome.runtime.getManifest().version}`

  elements.blockedDomains.innerText = await getStorageValue(
    STORAGE_KEYS.blockedDomains,
    0
  );

  await updateCurrentDomainInfo();
}

function setupEventListeners() {
  elements.statusToggle.addEventListener("change", toggleAppStatus);
  elements.changeDomainStatusBtn.addEventListener(
    "click",
    handleDomainStatusToggle
  );
}

function observeStorageChanges() {
  chrome.storage.local.onChanged.addListener(async (changes) => {
    if (changes[STORAGE_KEYS.blockedDomains]) {
      elements.blockedDomains.innerText =
        changes[STORAGE_KEYS.blockedDomains].newValue;
    }
  });
}

async function toggleAppStatus() {
  const newStatus = elements.statusToggle.checked;
  await chrome.storage.local.set({ [ENABLED_APP_KEY]: newStatus });
}

async function handleDomainStatusToggle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = new URL(tab.url);
  const excludedDomains = await getStorageValue(
    EXCLUDED_DOMAINS_STORAGE_KEY,
    []
  );
  const isExist = excludedDomains.some((item) => item === url.hostname);

  const updatedExcludedDomains = isExist
    ? excludedDomains.filter((item) => item !== url.hostname)
    : [...excludedDomains, url.hostname];

  await chrome.storage.local.set({
    [EXCLUDED_DOMAINS_STORAGE_KEY]: updatedExcludedDomains,
  });
  chrome.tabs.reload(tab.id);
  window.close();
}

async function updateCurrentDomainInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = new URL(tab.url);
  elements.currentDomain.innerText = url.hostname;

  if (url.hostname === "newtab") {
    elements.changeDomainStatusBtn.classList.add("none");
    return;
  }

  const excludedDomains = await getStorageValue(
    EXCLUDED_DOMAINS_STORAGE_KEY,
    []
  );
  const isExcluded = excludedDomains.some((item) => item === url.hostname);

  elements.changeDomainStatusBtn.classList.toggle("button-danger", !isExcluded);
  elements.changeDomainStatusBtn.classList.toggle("button-success", isExcluded);
  elements.changeDomainStatusBtn.innerText = isExcluded
    ? "Enable blocking for this domain"
    : "Disable blocking for this domain";
}

async function getStorageValue(key, defaultValue = null) {
  const storageData = await chrome.storage.local.get([key]);
  return storageData[key] ?? defaultValue;
}
