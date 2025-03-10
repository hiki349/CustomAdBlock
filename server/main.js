import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import { CronJob } from "cron";

import { convertFilter, compressRules } from "./libs/abp2dnr.js";
import { Filter } from "adblockpluscore/lib/filterClasses.js";

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { usersTable } from "./schema.js";
import { eq } from "drizzle-orm";

import fs from "fs";
import path from "path";

let globalRules = [];
let currentPatterns = [];
let whitelistDomains = [];
let customJsUrls = [];
let currentDynamicId = 400_000;
let currentBlocklistVersion = 0;

const URLS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
  "https://secure.fanboy.co.nz/fanboy-annoyance.txt",
  "https://easylist.to/easylist/fanboy-social.txt",
];

const CUSTOM_PATTERNS_PATH = path.join(process.cwd(), "custom_patterns.txt");
const CUSTOM_JS_MAP_PATH = path.join(process.cwd(), "customScripts.json");

const db = drizzle(process.env.DATABASE_URL);

const app = Fastify({
  logger: {
    level: "debug",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
});

app.register(fastifyStatic, {
  root: path.join(process.cwd(), "scripts"),
  prefix: "/scripts/",
});

await app.register(cors, {
  origin: "*",
});

const fetchList = async (url) => {
  try {
    const response = await fetch(url);
    return await response.text();
  } catch (err) {
    app.log.error(`There was an error loading from ${url}`, err);
    return "";
  }
};

const generateRules = async (filters, initID = 1) => {
  let id = initID;
  let rules = [];

  for (let filter of filters) {
    rules.push(await convertFilter(filter));
  }

  rules = compressRules(rules).flat();
  for (let rule of rules) {
    rule.id = id++;
  }

  return rules;
};

const convertToWhitelistDomains = (generatedRules = []) => {
  return generatedRules
    .filter((rule) => rule.action.type === "allow")
    .map((rule) =>
      rule.condition.urlFilter.split("/")[0].replace(/^\|\||\^\*?|\.\*$/g, "")
    )
    .filter((domain) => domain !== "");
};

const initRules = async () => {
  app.log.debug("Start convert rules...");

  const filters = [];

  for (const url of URLS) {
    const listText = await fetchList(url);
    const lines = listText.split("\n");
    currentPatterns.push(...lines);

    for (const [index, line] of lines.entries()) {
      if (index === 0) continue;

      filters.push(Filter.fromText(Filter.normalize(line)));
    }
  }

  const generatedRules = await generateRules(filters);
  whitelistDomains = convertToWhitelistDomains(generatedRules);

  fs.writeFileSync(
    path.join("../extension", "rules.json"),
    JSON.stringify(generatedRules, null, 2)
  );

  app.log.debug("Finish convert rules");
};

const updateRules = async () => {
  app.log.debug("Start update rules");

  const prevLines = new Set(currentPatterns);
  const filters = [];

  for (const url of URLS) {
    const listText = await fetchList(url);
    const lines = listText.split("\n");
    const filteredLines = lines.filter((line) => !prevLines.has(line));
    currentPatterns.push(...lines);

    for (const line of filteredLines) {
      filters.push(Filter.fromText(Filter.normalize(line)));
    }
  }

  const customText = fs.readFileSync(CUSTOM_PATTERNS_PATH, "utf8");
  const customLines = customText.split("\n");
  const filteredCustomLines = customLines.filter(
    (line) => !prevLines.has(line)
  );
  currentPatterns.push(...filteredCustomLines);
  for (const line of filteredCustomLines) {
    filters.push(Filter.fromText(Filter.normalize(line)));
  }

  const rules = await generateRules(filters, currentDynamicId);
  currentDynamicId += filters.length;
  const newWhitelistDomains = convertToWhitelistDomains(rules).filter(
    (domain) => !whitelistDomains.includes(domain)
  );

  const customJsData = await fs.promises.readFile(
    CUSTOM_JS_MAP_PATH,
    "utf-8"
  );
  customJsUrls = JSON.parse(customJsData);
  for (const [key, filePath] of Object.entries(customJsUrls)) {
    const fullPath = path.join(process.cwd(), filePath);
    try {
      const fileContent = await fs.promises.readFile(fullPath, "utf-8");
      customJsUrls[key] = fileContent;
    } catch (err) {
      app.log.error(
        `An error occurred when read file ${filePath}: ${err.message}`
      );
      customJsUrls[key] = null;
    }
  }
  currentBlocklistVersion++;

  if (newWhitelistDomains.length && rules.length) {
    whitelistDomains.push(...newWhitelistDomains);
    globalRules.push(...rules);
  }

  app.log.debug("Finish update rules");
};

app.post("/black-list", async (request, reply) => {
  try {
    const data = JSON.parse(request.body);
    if (data.current_blocklist_version === currentBlocklistVersion) {
      return reply.send({ update: false });
    }

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, data.id));
    if (!user.length) {
      await db.insert(usersTable).values({
        id: data.id,
        install_time: data.install_time,
        visited_domains_count: data.visited_domains_count,
        blocked_domains_count: data.blocked_domains_count,
        allow_domains_count: data.allow_domains_count,
      });
    } else {
      await db
        .update(usersTable)
        .set({
          visited_domains_count: data.visited_domains_count,
          blocked_domains_count: data.blocked_domains_count,
          allow_domains_count: data.allow_domains_count,
        })
        .where(eq(usersTable.id, data.id));
    }

    return reply.send({
      update: true,
      blocklist_version: currentBlocklistVersion,
      rules: globalRules,
      custom_js_urls: customJsUrls,
      whitelist_domains: whitelistDomains,
    });
  } catch (error) {
    app.log.error(error);
    reply.code(500).send({ error: "Internal Server Error" });
  }
});

const start = async () => {
  try {
    await initRules();
    await updateRules();
    await app.listen({ port: 3000 });
    new CronJob("0 0 0 * * *", updateRules, null, true, "UTC");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
