const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const indexPath = path.join(rootDir, "index.json");

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read JSON from ${path.relative(rootDir, filePath)}: ${error.message}`);
  }
}

async function getExistingIndexOrder() {
  try {
    const index = await readJson(indexPath);
    if (!Array.isArray(index.data)) {
      return [];
    }

    return index.data.map((entry) => entry && entry.id).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    return [];
  }
}

function normalizeProperties(properties) {
  const normalized = {};
  const name = properties.name || properties.title;

  if (properties.id) {
    normalized.id = properties.id;
  }

  if (name) {
    normalized.name = name;
  }

  for (const [key, value] of Object.entries(properties)) {
    if (key !== "id" && key !== "name" && key !== "title") {
      normalized[key] = value;
    }
  }

  return normalized;
}

function validateDataset(fileName, dataset) {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new Error(`${fileName} must contain a JSON object.`);
  }

  if (!dataset.properties || typeof dataset.properties !== "object" || Array.isArray(dataset.properties)) {
    throw new Error(`${fileName} must contain a properties object.`);
  }

  if (!Array.isArray(dataset.data)) {
    throw new Error(`${fileName} must contain a data array.`);
  }

  if (!dataset.properties.id) {
    throw new Error(`${fileName} must contain properties.id.`);
  }
}

function sortEntries(entries, existingOrder) {
  const existingPosition = new Map(existingOrder.map((id, index) => [id, index]));

  return entries.sort((a, b) => {
    const aPosition = existingPosition.get(a.id);
    const bPosition = existingPosition.get(b.id);

    if (aPosition !== undefined && bPosition !== undefined) {
      return aPosition - bPosition;
    }

    if (aPosition !== undefined) {
      return -1;
    }

    if (bPosition !== undefined) {
      return 1;
    }

    return a.id.localeCompare(b.id);
  });
}

function latestUpdated(entries) {
  const dates = entries.map((entry) => entry.updated).filter(Boolean).sort();
  return dates.at(-1) || new Date().toISOString().slice(0, 10);
}

function buildIndexEntry(properties, fileName, size) {
  const knownKeys = ["id", "name", "description", "license", "category", "tags"];
  const entry = {};

  for (const key of knownKeys) {
    if (properties[key] !== undefined) {
      entry[key] = properties[key];
    }
  }

  entry.format = "json";

  for (const [key, value] of Object.entries(properties)) {
    if (!knownKeys.includes(key) && key !== "updated") {
      entry[key] = value;
    }
  }

  if (properties.updated) {
    entry.updated = properties.updated;
  }

  entry.size = size;
  entry.path = path.posix.join("data", fileName);

  return entry;
}

async function buildIndex() {
  const dirEntries = await fs.readdir(dataDir, { withFileTypes: true });
  const datasetFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  const existingOrder = await getExistingIndexOrder();
  const entries = [];
  const seenIds = new Set();

  for (const fileName of datasetFiles) {
    const filePath = path.join(dataDir, fileName);
    const dataset = await readJson(filePath);
    validateDataset(fileName, dataset);

    const properties = normalizeProperties(dataset.properties);

    if (seenIds.has(properties.id)) {
      throw new Error(`Duplicate dataset id "${properties.id}" in ${fileName}.`);
    }

    seenIds.add(properties.id);

    entries.push(buildIndexEntry(properties, fileName, dataset.data.length));
  }

  const sortedEntries = sortEntries(entries, existingOrder);
  const index = {
    properties: {
      size: sortedEntries.length,
      updated: latestUpdated(sortedEntries),
    },
    data: sortedEntries,
  };

  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

buildIndex().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
