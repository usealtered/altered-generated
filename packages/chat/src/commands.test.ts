import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLeadFields, parseCommand } from "./commands";

test("plain text defaults to cursor", () => {
  const cmd = parseCommand("Ship the deposit checkout tonight");
  assert.equal(cmd.type, "cursor");
  if (cmd.type === "cursor") {
    assert.match(cmd.prompt, /deposit checkout/);
  }
});

test("ask command", () => {
  const cmd = parseCommand("ask what is the deposit?");
  assert.equal(cmd.type, "ask");
  if (cmd.type === "ask") assert.equal(cmd.query, "what is the deposit?");
});

test("plan mode", () => {
  const cmd = parseCommand("plan improve conversion");
  assert.equal(cmd.type, "cursor");
  if (cmd.type === "cursor") assert.equal(cmd.mode, "plan");
});

test("lead extraction", () => {
  const fields = extractLeadFields("jane@acme.com +15551234567 wants RAG");
  assert.equal(fields.email, "jane@acme.com");
  assert.ok(fields.phone?.includes("555"));
});
