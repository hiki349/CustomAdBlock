import {
  CommentFilter,
  ContentFilter,
  Filter,
  InvalidFilter,
  AllowingFilter,
} from "adblockpluscore/lib/filterClasses.js";
import rewriteResources from "adblockpluscore/data/resources.json" with {type: 'json'};
import { contentTypes } from "adblockpluscore/lib/contentTypes.js";

export const GENERIC_PRIORITY = 1000;
export const GENERIC_ALLOW_ALL_PRIORITY = 1001;
export const SPECIFIC_PRIORITY = 2000;
export const SPECIFIC_ALLOW_ALL_PRIORITY = 2001;

const MAIN_FRAME_SUB_FRAME = Symbol();

const URLFILTER_PARTS_REGEXP = /^(\|\||[a-zA-Z]*:\/\/)([^*^?/|]*)(.*)$/;

const requestTypes = new Map([
  [contentTypes.OTHER, ["other", "csp_report"]],
  [contentTypes.SCRIPT, ["script"]],
  [contentTypes.IMAGE, ["image"]],
  [contentTypes.STYLESHEET, ["stylesheet"]],
  [contentTypes.OBJECT, ["object"]],
  [contentTypes.SUBDOCUMENT, ["sub_frame"]],
  [contentTypes.WEBSOCKET, ["websocket"]],
  [contentTypes.PING, ["ping"]],
  [contentTypes.XMLHTTPREQUEST, ["xmlhttprequest"]],
  [contentTypes.MEDIA, ["media"]],
  [contentTypes.FONT, ["font"]],
]);

const supportedRequestTypes = Array.from(requestTypes.keys()).reduce(
  (srt, t) => srt | t
);

contentTypes.OBJECT_SUBREQUEST = contentTypes.OBJECT;

function getResourceTypes(filterContentType) {
  if ((filterContentType & supportedRequestTypes) == supportedRequestTypes) {
    return;
  }

  let result = [];

  for (let [mask, types] of requestTypes) {
    if (filterContentType & mask) result = result.concat(types);
  }

  return result;
}

function getDomains(filterDomains) {
  let domains = [];
  let excludedDomains = [];
  let isGenericFilter = true;

  if (filterDomains) {
    for (let [domain, enabled] of filterDomains) {
      if (domain == "") isGenericFilter = enabled;
      else (enabled ? domains : excludedDomains).push(domain);
    }
  }

  return { domains, excludedDomains, isGenericFilter };
}

function getConditions(filter, urlFilter, resourceTypes, matchCase) {
  let mainFrameSubFrame = false;
  let conditions = [];
  let condition = {};

  if (urlFilter) condition.urlFilter = urlFilter;
  else if (filter.regexp) condition.regexFilter = filter.regexp.source;

  if (resourceTypes) {
    if (resourceTypes === MAIN_FRAME_SUB_FRAME) mainFrameSubFrame = true;
    else condition.resourceTypes = resourceTypes;
  }

  if (!matchCase && (condition.urlFilter || condition.regexFilter))
    condition.isUrlFilterCaseSensitive = false;

  if (filter.thirdParty != null)
    condition.domainType = filter.thirdParty ? "thirdParty" : "firstParty";

  let { domains, excludedDomains, isGenericFilter } = getDomains(
    filter.domains
  );

  if (mainFrameSubFrame) {
    if (domains.length || excludedDomains.length) {
      let mainFrameCondition = JSON.parse(JSON.stringify(condition));
      if (domains.length) mainFrameCondition.requestDomains = domains;
      if (excludedDomains.length)
        mainFrameCondition.excludedRequestDomains = excludedDomains;
      mainFrameCondition.resourceTypes = ["main_frame"];
      conditions.push(mainFrameCondition);

      condition.resourceTypes = ["sub_frame"];
    } else condition.resourceTypes = ["main_frame", "sub_frame"];
  }

  if (domains.length) condition.initiatorDomains = domains;
  if (excludedDomains.length)
    condition.excludedInitiatorDomains = excludedDomains;

  conditions.push(condition);
  return [conditions, isGenericFilter];
}

function generateRedirectRules(filter, urlFilter, matchCase) {
  let url = rewriteResources[filter.rewrite];

  if (!url) return [];

  let resourceTypes = getResourceTypes(filter.contentType);

  if (resourceTypes && resourceTypes.length == 0) return [];

  let [conditions, isGenericFilter] = getConditions(
    filter,
    urlFilter,
    resourceTypes,
    matchCase
  );
  let priority = isGenericFilter ? GENERIC_PRIORITY : SPECIFIC_PRIORITY;

  return conditions.map((condition) => ({
    priority,
    condition,
    action: {
      type: "redirect",
      redirect: { url },
    },
  }));
}

function generateCSPRules(filter, urlFilter, matchCase) {
  let [conditions, isGenericFilter] = getConditions(
    filter,
    urlFilter,
    MAIN_FRAME_SUB_FRAME,
    matchCase
  );
  let priority =
    filter.contentType & contentTypes.GENERICBLOCK
      ? GENERIC_PRIORITY
      : SPECIFIC_PRIORITY;

  return conditions.map((condition) => {
    if (filter instanceof AllowingFilter) {
      return {
        action: {
          type: "allow",
        },
        condition,
        priority,
      };
    }

    return {
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "Content-Security-Policy",
            operation: "append",
            value: filter.csp,
          },
        ],
      },
      condition,
      priority: isGenericFilter ? GENERIC_PRIORITY : SPECIFIC_PRIORITY,
    };
  });
}

function generateBlockRules(filter, urlFilter, matchCase) {
  let resourceTypes = getResourceTypes(filter.contentType);

  if (resourceTypes && resourceTypes.length == 0) return [];

  let [conditions, isGenericFilter] = getConditions(
    filter,
    urlFilter,
    resourceTypes,
    matchCase
  );
  let priority = isGenericFilter ? GENERIC_PRIORITY : SPECIFIC_PRIORITY;

  return conditions.map((condition) => ({
    priority,
    condition,
    action: {
      type: "block",
    },
  }));
}

function generateAllowRules(filter, urlFilter, matchCase) {
  let rules = [];
  let { contentType } = filter;

  let genericBlock = contentType & contentTypes.GENERICBLOCK;

  if (contentType & contentTypes.DOCUMENT || genericBlock) {
    contentType &= ~contentTypes.SUBDOCUMENT;

    let priority = genericBlock
      ? GENERIC_ALLOW_ALL_PRIORITY
      : SPECIFIC_ALLOW_ALL_PRIORITY;
    for (let condition of getConditions(
      filter,
      urlFilter,
      MAIN_FRAME_SUB_FRAME,
      matchCase
    )[0]) {
      rules.push({
        priority,
        condition,
        action: {
          type: "allowAllRequests",
        },
      });
    }
  }

  let resourceTypes = getResourceTypes(contentType);
  if (!resourceTypes || resourceTypes.length) {
    let priority = genericBlock ? GENERIC_PRIORITY : SPECIFIC_PRIORITY;
    for (let condition of getConditions(
      filter,
      urlFilter,
      resourceTypes,
      matchCase
    )[0]) {
      rules.push({
        priority,
        condition,
        action: {
          type: "allow",
        },
      });
    }
  }

  return rules;
}

export async function convertFilter(filter, isRegexSupported) {
  filter = Filter.fromText(filter.text);

  if (!(filter instanceof Filter)) return [];
  if (filter instanceof CommentFilter || filter instanceof InvalidFilter)
    return [];
  if (/[^\x00-\x7F]/.test(filter.text)) return [];
  if (filter.sitekeys) return [];
  if (filter instanceof ContentFilter) return [];

  let { matchCase, pattern: urlFilter } = filter;
  let hostname;

  if (urlFilter) {
    let match = URLFILTER_PARTS_REGEXP.exec(filter.pattern);
    if (match) {
      hostname = match[2].toLowerCase();

      urlFilter = match[1] + hostname + match[3];
      matchCase =
        matchCase || match[3].length < 2 || !/[a-zA-Z]/.test(match[3]);
    }

    if (urlFilter.startsWith("||*")) urlFilter = urlFilter.substr(3);
  } else if (
    filter.regexp &&
    !(
      isRegexSupported &&
      (
        await isRegexSupported({
          regex: filter.regexp.source,
          isCaseSensitive: matchCase,
        })
      ).isSupported
    )
  ) {
    return [];
  }

  let result;

  if (filter.contentType & contentTypes.CSP)
    result = generateCSPRules(filter, urlFilter, matchCase);
  else if (filter instanceof AllowingFilter)
    result = generateAllowRules(filter, urlFilter, matchCase);
  else if (filter.rewrite)
    result = generateRedirectRules(filter, urlFilter, matchCase);
  else result = generateBlockRules(filter, urlFilter, matchCase);

  return result;
}

export function compressRules(rules) {
  let compressedRules = [];
  let requestDomainsByStringifiedRule = new Map();
  let urlFilterByStringifiedRule = new Map();

  for (let rule of rules) {
    if (
      rule.condition &&
      rule.condition.urlFilter &&
      !rule.condition.requestDomains &&
      !rule.condition.excludedRequestDomains
    ) {
      let match = URLFILTER_PARTS_REGEXP.exec(rule.condition.urlFilter);
      if (match && match[1] == "||" && match[2] && match[3] == "^") {
        let { urlFilter } = rule.condition;
        delete rule.condition.urlFilter;

        let key = JSON.stringify(rule);
        urlFilterByStringifiedRule.set(key, urlFilter);

        let requestDomains = requestDomainsByStringifiedRule.get(key);
        if (!requestDomains) {
          requestDomains = [];
          requestDomainsByStringifiedRule.set(key, requestDomains);
        }
        requestDomains.push(match[2].toLowerCase());
        continue;
      }
    }

    compressedRules.push(rule);
  }

  for (let [stringifiedRule, domains] of requestDomainsByStringifiedRule) {
    let rule = JSON.parse(stringifiedRule);
    if (domains.length > 1) rule.condition.requestDomains = domains;
    else
      rule.condition.urlFilter =
        urlFilterByStringifiedRule.get(stringifiedRule);

    compressedRules.push(rule);
  }

  return compressedRules;
}
