import { z } from "zod";
import { appSchema } from "../../src/lib/draft-schema.mjs";
import { AuthError } from "./errors.mjs";

const limits = { receipts: 100, groups: 50 };
const group = z.strictObject({
  name: z.string().trim().min(1).max(80),
  people: z.array(z.string().trim().min(1).max(50)).min(1).max(30),
});

function draftPayload(draft) {
  return {
    ...draft,
    finalizedStamp: "",
    receipt: { ...draft.receipt, rawText: "" },
  };
}

export const documentSchemas = {
  receipts: appSchema.transform(draftPayload),
  groups: group,
};

const entry = (row) => ({
  id: row.id,
  title: row.title,
  savedAt: Number(row.saved_at),
});

export function accountDocuments(database, now = Date.now) {
  return {
    async list(ownerId, kind) {
      const { rows } = await database.query(
        `SELECT id, title, saved_at FROM gather_saved_documents
         WHERE owner_id = $1 AND kind = $2 ORDER BY saved_at DESC, id`,
        [ownerId, kind],
      );
      return rows.map(entry);
    },

    async get(ownerId, kind, id) {
      const { rows } = await database.query(
        "SELECT id, title, payload, saved_at FROM gather_saved_documents WHERE owner_id = $1 AND kind = $2 AND id = $3",
        [ownerId, kind, id],
      );
      if (!rows.length) throw new AuthError("not_found");
      return { ...entry(rows[0]), payload: rows[0].payload };
    },

    async save(ownerId, kind, id, payload) {
      return database.transaction(async (db) => {
        await db.query("SELECT id FROM gather_users WHERE id = $1 FOR UPDATE", [
          ownerId,
        ]);
        const existing = await db.query(
          "SELECT id, title, saved_at FROM gather_saved_documents WHERE owner_id = $1 AND kind = $2 AND id = $3",
          [ownerId, kind, id],
        );
        if (existing.rows.length) return entry(existing.rows[0]);
        const { rows: counts } = await db.query(
          "SELECT count(*) AS total FROM gather_saved_documents WHERE owner_id = $1 AND kind = $2",
          [ownerId, kind],
        );
        if (Number(counts[0].total) >= limits[kind])
          throw new AuthError("save_limit");
        const title =
          kind === "receipts"
            ? payload.receipt.merchant.trim() || "Receipt"
            : payload.name;
        const { rows } = await db.query(
          `INSERT INTO gather_saved_documents(owner_id, kind, id, title, payload, saved_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id, title, saved_at`,
          [ownerId, kind, id, title, JSON.stringify(payload), now()],
        );
        return entry(rows[0]);
      });
    },

    async remove(ownerId, kind, id) {
      const { rowCount, affectedRows } = await database.query(
        "DELETE FROM gather_saved_documents WHERE owner_id = $1 AND kind = $2 AND id = $3",
        [ownerId, kind, id],
      );
      if (!(rowCount ?? affectedRows)) throw new AuthError("not_found");
    },
  };
}
