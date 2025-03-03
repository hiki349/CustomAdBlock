import Fastify from "fastify";
import cors from "@fastify/cors";

import { CronJob } from "cron";

let globalRules;

const URLS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
];

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

const updateRules = async () => {
  app.log.debug("Start convert rules...");

  const rules = [];

  for (const url of URLS) {
    const urlFilterSet = new Set(globalRules?.map(({ rule }) => rule));
    const listText = await fetchList(url);
    const lines = listText
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith("!") &&
          !line.startsWith("[") &&
          !urlFilterSet.has(line)
      );

    let id = rules.length + 1;

    for (let line of lines) {
      rules.push({
        id: id++,
        rule: line,
      });
    }
  }

  globalRules = rules;
  app.log.debug("Finish convert rules");
};

app.get("/black-list", async (request, reply) => {
  try {
    const oldIds = request.query?.["old-ids"]?.split(",") || [];
    const data =
      oldIds.length > 0
        ? globalRules.filter(({ id }) => !oldIds.includes(id.toString()))
        : globalRules;

    return reply.send(data);
  } catch (err) {
    app.log.error(err);
    reply.status(500).send({ error: "Error reading file" });
  }
});

const start = async () => {
  try {
    new CronJob("0 0 * * * *", updateRules, null, true, "UTC");
    await updateRules();

    await app.listen({ port: 3000 });
    app.log.info(`Server listening on http://localhost:3000`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
