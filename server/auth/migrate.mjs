import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./migrations/", import.meta.url));
const schemaLock = 12586481;

export async function migrateAccounts(database) {
  const migrations = (await readdir(directory))
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .sort();
  return database.transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [schemaLock]);
    await db.query(
      "CREATE TABLE IF NOT EXISTS gather_schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await db.query(
      "SELECT version FROM gather_schema_version ORDER BY version",
    );
    const versions = migrations.map((name) => Number(name.slice(0, 3)));
    if (rows.some(({ version }, index) => version !== versions[index]))
      throw new Error("Gather account schema has an unexpected version.");
    for (const name of migrations.slice(rows.length)) {
      await db.exec(
        await readFile(
          new URL("./migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
      await db.query("INSERT INTO gather_schema_version(version) VALUES ($1)", [
        Number(name.slice(0, 3)),
      ]);
    }
    return versions.at(-1);
  });
}
