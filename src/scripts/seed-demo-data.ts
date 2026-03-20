import path from "node:path";

import { DatabaseManager } from "../db/database";

async function run() {
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "trippilot.sqlite");
  const db = new DatabaseManager(dbPath);

  await db.init();

  const eventCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM events;");
  const userCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users;");
  const registrationCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM registrations;");

  console.log(
    `Demo seed complete. Users: ${Number(userCount?.count ?? 0)}, events: ${Number(eventCount?.count ?? 0)}, registrations: ${Number(registrationCount?.count ?? 0)}.`,
  );
}

run().catch((error) => {
  console.error("Failed to seed demo data:", error);
  process.exit(1);
});
