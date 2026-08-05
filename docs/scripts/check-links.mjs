import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const appDir = path.resolve("app");

async function findPages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return findPages(target);
      return entry.name === "page.tsx" ? [target] : [];
    })
  );
  return nested.flat();
}

function routeForPage(file) {
  const relative = path.relative(appDir, path.dirname(file));
  return relative === "" ? "/" : `/${relative.split(path.sep).join("/")}`;
}

const pageFiles = await findPages(appDir);
const pages = new Map();

for (const file of pageFiles) {
  const source = await readFile(file, "utf8");
  const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  pages.set(routeForPage(file), { file, ids, source });
}

const failures = [];

function validateLinks(sourceName, links) {
  for (const href of links) {
    const [targetRoute, hash] = href.split("#");
    const target = pages.get(targetRoute || sourceName);
    if (!target) {
      failures.push(`${sourceName}: missing route ${targetRoute}`);
      continue;
    }
    if (hash && !target.ids.has(hash)) {
      failures.push(`${sourceName}: missing anchor ${href}`);
    }
  }
}

for (const [sourceRoute, page] of pages) {
  const links = [...page.source.matchAll(/\bhref=["'](\/[^"']*)["']/g)].map(
    (match) => match[1]
  );
  validateLinks(sourceRoute, links);
}

const navigationSource = await readFile(path.resolve("lib/navigation.ts"), "utf8");
const navigationLinks = [
  ...navigationSource.matchAll(/\bhref:\s*["'](\/[^"']*)["']/g),
].map((match) => match[1]);
validateLinks("navigation", navigationLinks);

if (failures.length > 0) {
  console.error("Internal link check failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Checked ${pages.size} documentation routes.`);
