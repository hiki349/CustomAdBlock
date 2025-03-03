const API_URL = "http://localhost:3000";
const UPDATE_BLOCK_LIST_KEY = "update-block-list-key";

let rules;
let isFlag = true;

function isUrlBlocked(url) {
  return rules.some((rule) => {
    if (rule.startsWith("||")) {
      const domain = rule.slice(2, -1);
      return url.includes(domain);
    }

    if (rule.includes("*")) {
      return url.includes(rule.replace("*", ""));
    }

    return false;
  });
}

async function updateRules() {
  try {
    const response = await fetch(`${API_URL}/black-list`);
    if (!response.ok) {
      throw new Error(`Failed to fetch rules: ${response.statusText}`);
    }
    const rules = await response.json();

    const oldRuleIds = rules.map((rule) => rule.id);
    const filteredRules = rules.filter(({ id }) => !oldRuleIds.includes(id));

    rules = filteredRules;
  } catch (error) {
    console.log("An error occurred while updating rules", error);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
   ({ url }) => {
    const hostname = new URL(url).hostname;

    if (isFlag) {
      chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [
          {
            id: Math.floor(Math.random() * 100),
            action: { type: "block" },
            condition: {
              urlFilter: hostname,
            },
          },
        ],
      });
      isFlag = false
    }
  },
  { urls: ["<all_urls>"] },
  []
);

chrome.declarativeNetRequest


chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  updateRules();

  await chrome.alarms.create(UPDATE_BLOCK_LIST_KEY, {
    periodInMinutes: 1440,
  });
});

// chrome.alarms.onAlarm.addListener(async (alarm) => {
//   if (alarm.name !== UPDATE_BLOCK_LIST_KEY) return;

//   updateRules();
// });
