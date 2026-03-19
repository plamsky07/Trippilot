import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import request from "supertest";

import { createApp } from "../src/app";

function createTempDbPath(): string {
  return path.join(process.cwd(), "data", `test-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

async function run() {
  const dbPath = createTempDbPath();

  try {
    const app = await createApp({ dbPath });
    const agent = request.agent(app);

    const loginResponse = await agent.post("/login").type("form").send({
      email: "student@trippilot.local",
      password: "Student123!",
    });

    assert.equal(loginResponse.status, 302);
    assert.equal(loginResponse.headers.location, "/events");

    const registerResponse = await agent.post("/events/1/register").type("form").send({});

    assert.equal(registerResponse.status, 302);
    assert.equal(registerResponse.headers.location, "/events/1");

    const detailsResponse = await agent.get("/events/1");

    assert.equal(detailsResponse.status, 200);
    assert.match(detailsResponse.text, /Отказвам участие/);
    assert.match(detailsResponse.text, /Съгласие: pending/);

    console.log("Smoke test passed: student login and trip registration flow works.");
  } finally {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
}

run().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
