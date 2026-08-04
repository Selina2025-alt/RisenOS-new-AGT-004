import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(connectionString, { max: 1 });
const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const files = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const existing = await sql`
      SELECT name FROM schema_migrations WHERE name = ${name}
    `;
    if (existing.length > 0) continue;
    const migration = await readFile(
      new URL(`../migrations/${name}`, import.meta.url),
      "utf8",
    );
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`
        INSERT INTO schema_migrations (name) VALUES (${name})
      `;
    });
    console.log(`Applied migration ${name}`);
  }
  console.log("AGT-RSN-004 database migrations completed");
} finally {
  await sql.end();
}
