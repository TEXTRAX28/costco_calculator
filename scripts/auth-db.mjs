import { resolve } from "node:path";
import { z } from "zod";
import { authSettings } from "../server/auth/config.mjs";
import { postgresDatabase } from "../server/auth/database.mjs";
import { migrateAccounts } from "../server/auth/migrate.mjs";
import { accountStore } from "../server/auth/store.mjs";

const [operation, userId, ...extra] = process.argv.slice(2);
const supported = ["migrate", "prune", "revoke"];
let database;
try {
  if (
    !supported.includes(operation) ||
    extra.length ||
    (operation === "revoke" ? !z.uuid().safeParse(userId).success : userId)
  )
    throw new Error(
      "Use migrate, prune, or revoke followed by a Gather user UUID.",
    );
  const config = authSettings(resolve(import.meta.dirname, ".."));
  if (!config) throw new Error("Enable account configuration first.");
  database = postgresDatabase(config.database);
  if (operation === "migrate")
    console.log(
      "Gather accounts schema version",
      await migrateAccounts(database),
    );
  else {
    const store = accountStore(database, config);
    await (operation === "prune" ? store.prune() : store.revokeUser(userId));
    console.log(
      operation === "prune"
        ? "Expired account records were pruned."
        : "Gather sessions were revoked.",
    );
  }
} catch {
  console.error(
    "The accounts database command could not finish. Check the command, database, and server settings.",
  );
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => {});
}
