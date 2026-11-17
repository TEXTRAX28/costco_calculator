import pg from "pg";

export function postgresDatabase(settings, onUnavailable = () => {}) {
  const pool = new pg.Pool({
    ...settings,
    application_name: "gather-accounts",
    max: 6,
    connectionTimeoutMillis: 2500,
    idleTimeoutMillis: 15_000,
    statement_timeout: 3500,
    lock_timeout: 2000,
    allowExitOnIdle: true,
  });
  pool.on("error", onUnavailable);
  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction(operation) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const result = await operation({
          query: (sql, params) => connection.query(sql, params),
          exec: (sql) => connection.query(sql),
        });
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
