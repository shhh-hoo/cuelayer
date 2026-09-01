import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to migrate the Session Event Store");
const migration = await readFile(resolve("db/migrations/001_session_event_store.sql"), "utf8");
const sql = neon(url);
for (const statement of migration.split(";").map((entry) => entry.replace(/^--.*$/gm, "").trim()).filter(Boolean)) await sql.query(statement);
console.log("Session Event Store migration applied.");
