const API_URL = "http://localhost:3000";
const UPDATE_BLOCK_LIST_KEY = "update-block-list-key";
const TEMP_STORAGE_KEY = "pendingBlockRules";
const CUSTOM_JS_STORAGE_KEY = "custom-js-storage-key";
const ENABLED_APP_KEY = "enabled-app-key";
const EXCLUDED_DOMAINS_STORAGE_KEY = "excluded-domains-storage-key";
const BLOCKLIST_VERSION_STORAGE_KEY = "blocklist-version-storage-key";
const USER_DATA_KEYS = {
  ID: "id",
  INSTALL_TIME: "install-time",
  VISITED_DOMAINS: "visited-domains",
  BLOCKED_DOMAINS_COUNT: "blocked-domains-count",
  ALLOW_DOMAINS: "whitelist",
  ALLOW_DOMAINS_COUNT: "whitelist-count",
};
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const UPDATE_TIMEOUT_MS = 10000;
const BATCH_SIZE = 200;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
let isAppEnabled;

async function resumePendingUpdate() {
  const data = await chrome.storage.local.get(TEMP_STORAGE_KEY);
  const pendingRules = data[TEMP_STORAGE_KEY];

  if (pendingRules) {
    await applyRules(pendingRules);
  }
}

async function updateRules() {
  let attempt = 0;
  let timeoutId;

  while (attempt < MAX_RETRIES) {
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
      const userData = await getUserData();

      const response = await fetch(`${API_URL}/black-list`, {
        method: "POST",
        body: JSON.stringify(userData),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch rules: ${response.statusText}`);
      }

      const data = await response.json();
      clearTimeout(timeoutId);
      if (!data.update) return;

      await chrome.storage.local.set({
        [TEMP_STORAGE_KEY]: data.rules,
        [CUSTOM_JS_STORAGE_KEY]: data.custom_js_urls,
        [USER_DATA_KEYS.ALLOW_DOMAINS]: data.whitelist_domains,
        [BLOCKLIST_VERSION_STORAGE_KEY]: data.blocklist_version,
      });

      await applyRules(data.rules);
      return;
    } catch (error) {
      clearTimeout(timeoutId);
      attempt++;

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt))
        );
      } else {
        console.error("An error occurred while updating rules", error);
      }
    }
  }
}

async function getUserData() {
  const storageUserData = await chrome.storage.local.get(
    Object.values(USER_DATA_KEYS)
  );
  const storageData = await chrome.storage.local.get({
    [BLOCKLIST_VERSION_STORAGE_KEY]: -1,
  });
  const currentBlocklistVersion = storageData[BLOCKLIST_VERSION_STORAGE_KEY];

  return {
    id: storageUserData[USER_DATA_KEYS.ID],
    install_time: storageUserData[USER_DATA_KEYS.INSTALL_TIME],
    visited_domains_count: Object.keys(
      storageUserData[USER_DATA_KEYS.VISITED_DOMAINS] || {}
    ).length,
    blocked_domains_count:
      storageUserData[USER_DATA_KEYS.BLOCKED_DOMAINS_COUNT] || 0,
    allow_domains_count:
      storageUserData[USER_DATA_KEYS.ALLOW_DOMAINS_COUNT] || 0,
    current_blocklist_version: currentBlocklistVersion,
    extension_version: EXTENSION_VERSION,
  };
}

async function applyRules(rules) {
  const oldRules = (await chrome.declarativeNetRequest.getDynamicRules()) || [];
  const oldRulesId = oldRules.map((rule) => rule?.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRulesId,
  });

  for (let i = 0; i < rules.length; i += BATCH_SIZE) {
    const batch = rules.slice(i, i + BATCH_SIZE);

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: batch,
    });
  }

  await chrome.storage.local.remove(TEMP_STORAGE_KEY);
}

async function updateVisitedDomains(url) {
  try {
    let domain = url.hostname;
    if (url.protocol === "chrome:" || url.protocol === "about:") {
      return;
    }

    domain = domain.replace(/^www\./, "");
    if (!domain.trim() || domain === "new-tab-page") return;

    await chrome.storage.local.get(
      { [USER_DATA_KEYS.VISITED_DOMAINS]: {} },
      async (data) => {
        const visitedDomains = data[USER_DATA_KEYS.VISITED_DOMAINS];
        visitedDomains[domain] = (visitedDomains[domain] || 0) + 1;

        await chrome.storage.local.set({
          [USER_DATA_KEYS.VISITED_DOMAINS]: visitedDomains,
        });
      }
    );
  } catch (error) {
    console.error("An error occurred while updating visited domains", error);
  }
}

chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  const data = await chrome.storage.local.get({
    [USER_DATA_KEYS.BLOCKED_DOMAINS_COUNT]: 0,
  });
  let blockedCount = data[USER_DATA_KEYS.BLOCKED_DOMAINS_COUNT];

  blockedCount++;
  await chrome.storage.local.set({
    [USER_DATA_KEYS.BLOCKED_DOMAINS_COUNT]: blockedCount,
  });
});

function matchesDomain(domain, customJsMap) {
  return (
    customJsMap[domain] ||
    customJsMap[
      Object.keys(customJsMap).find((key) => domain.endsWith(`.${key}`))
    ]
  );
}

async function updateWhitelist(newValue) {
  try {
    await chrome.storage.local.set({
      [USER_DATA_KEYS.ALLOW_DOMAINS]: newValue,
    });
  } catch (error) {
    console.error("An error occurred when update whitelist", error);
  }
}

chrome.webNavigation.onCommitted.addListener(
  async (details) => {
    try {
      if (isAppEnabled === false) return;

      const url = new URL(details.url);
      const domain = url.hostname;
      const excludedDomains = await chrome.storage.local.get({
        [EXCLUDED_DOMAINS_STORAGE_KEY]: [],
      });
      if (excludedDomains[EXCLUDED_DOMAINS_STORAGE_KEY].includes(domain))
        return;
      await updateVisitedDomains(url);

      const data = await chrome.storage.local.get({
        [USER_DATA_KEYS.ALLOW_DOMAINS_COUNT]: 0,
        [CUSTOM_JS_STORAGE_KEY]: {},
        [USER_DATA_KEYS.ALLOW_DOMAINS]: [],
      });
      if (
        data[USER_DATA_KEYS.ALLOW_DOMAINS]?.some((item) =>
          domain.startsWith(item)
        )
      ) {
        await chrome.storage.local.set({
          [USER_DATA_KEYS.ALLOW_DOMAINS_COUNT]:
            data[USER_DATA_KEYS.ALLOW_DOMAINS_COUNT] + 1,
        });
        return;
      }
      const script = matchesDomain(domain, data[CUSTOM_JS_STORAGE_KEY] || {});

      if (script) {
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          world: "MAIN",
          func: (data) => new Function(data)(),
          args: [script],
        });
      }
    } catch (error) {
      console.error("An error occurred when loading script:", error);
    }
  },
  { url: [{ schemes: ["http", "https"] }] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headers = details.responseHeaders.map((header) => {
      if (header.name.toLowerCase() === "content-security-policy") {
        header.value = header.value
          .replace(
            /script-src[^;]+/,
            "script-src * 'unsafe-inline' 'unsafe-eval'"
          )
          .replace(
            /default-src[^;]+/,
            "default-src * 'unsafe-inline' 'unsafe-eval'"
          );
      }
      return header;
    });

    return { responseHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.storage.local.onChanged.addListener(async (changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    if (key === ENABLED_APP_KEY) {
      try {
        isAppEnabled = newValue;
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          [isAppEnabled ? "enableRulesetIds" : "disableRulesetIds"]: [
            "root_ruleset",
          ],
        });
      } catch (error) {
        console.error(
          "An error occurred when change ruleset ids status:",
          error
        );
      }
    }

    if (key === EXCLUDED_DOMAINS_STORAGE_KEY) {
      try {
        const oldRuleIds = (oldValue || []).map((_, i) => 500_000 + i);
        const newRules = newValue.map((val, i) => ({
          id: 500_000 + i,
          priority: 5000,
          action: { type: "allowAllRequests" },
          condition: {
            initiatorDomains: [val],
            resourceTypes: ["main_frame", "sub_frame"],
          },
        }));

        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: oldRuleIds,
          addRules: newRules,
        });
      } catch (error) {
        console.error("An error occurred when change excluded domains:", error);
      }
    }
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== UPDATE_BLOCK_LIST_KEY) return;
  updateRules();
});

chrome.runtime.onStartup.addListener(() => {
  resumePendingUpdate();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.storage.local.set({
      [USER_DATA_KEYS.INSTALL_TIME]: new Date().toISOString(),
      [USER_DATA_KEYS.ID]: crypto.randomUUID(),
      [USER_DATA_KEYS.BLOCKED_DOMAINS_COUNT]: 0,
      [USER_DATA_KEYS.ALLOW_DOMAINS]: [],
      [USER_DATA_KEYS.VISITED_DOMAINS]: {},
      [ENABLED_APP_KEY]: true,
    });
  }
  await updateRules();
  await chrome.alarms.create(UPDATE_BLOCK_LIST_KEY, {
    periodInMinutes: 1440,
  });

  await resumePendingUpdate();
});
