#!/usr/bin/env node
/**
 * Smoke test for telegram-mcp.
 *
 * Spawns ./server.js over stdio with the SDK Client and checks:
 *   1. tools/list exposes exactly the 5 expected tools
 *   2. tg_status returns a well-shaped status (logged_in:false is a PASS —
 *      the assertion is shape, not login)
 *   3. tg_download_url rejects a non-t.me url (validation works without login)
 *   4. tg_download_url rejects a garbage extensions csv (also login-free:
 *      validation runs before any tdl invocation)
 *
 * Exit 0 on pass, 1 on fail.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "..", "server.js");

const EXPECTED_TOOLS = [
  "tg_status",
  "tg_chats",
  "tg_messages",
  "tg_download",
  "tg_download_url",
];

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS: ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function firstText(result) {
  const block = (result.content || []).find((c) => c.type === "text");
  return block ? block.text : "";
}

const client = new Client({ name: "tdl-mcp-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  stderr: "pipe",
});

try {
  await client.connect(transport);

  // 1. tools/list — exactly the 5 expected tool names
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = [...EXPECTED_TOOLS].sort();
  check(
    "tools/list exposes exactly the 5 expected tools",
    JSON.stringify(names) === JSON.stringify(expected),
    `got [${names.join(", ")}]`
  );

  // 2. tg_status — shape assertion (logged_in:false is fine on this machine)
  const statusResult = await client.callTool({
    name: "tg_status",
    arguments: {},
  });
  const statusText = firstText(statusResult);
  console.log(`tg_status result: ${statusText}`);
  let status = null;
  try {
    status = JSON.parse(statusText);
  } catch {
    /* handled below */
  }
  const statusShapeOk =
    status !== null &&
    typeof status.logged_in === "boolean" &&
    (status.logged_in
      ? typeof status.chats === "number"
      : typeof status.hint === "string") &&
    !statusResult.isError;
  check(
    "tg_status returns well-shaped status without erroring",
    statusShapeOk,
    `logged_in=${status?.logged_in}`
  );

  // 3. tg_download_url with a non-t.me url must be rejected
  const badUrlResult = await client.callTool({
    name: "tg_download_url",
    arguments: { urls: ["https://evil.example/x"] },
  });
  const badUrlText = firstText(badUrlResult);
  check(
    "tg_download_url rejects a non-t.me url",
    badUrlResult.isError === true && /invalid url/i.test(badUrlText),
    badUrlText.slice(0, 120)
  );

  // 4. tg_download_url with a garbage extensions csv must be rejected
  //    (validated before any tdl call, so this is login-free too)
  const badExtResult = await client.callTool({
    name: "tg_download_url",
    arguments: { urls: ["https://t.me/somechannel/1"], extensions: ",,." },
  });
  const badExtText = firstText(badExtResult);
  check(
    "tg_download_url rejects a garbage extensions csv",
    badExtResult.isError === true && /invalid extensions/i.test(badExtText),
    badExtText.slice(0, 120)
  );
} catch (err) {
  failures += 1;
  console.log(`FAIL: smoke run crashed — ${err?.message || err}`);
} finally {
  try {
    await client.close();
  } catch {
    /* already closed */
  }
}

if (failures === 0) {
  console.log("SMOKE PASS (4/4)");
  process.exit(0);
} else {
  console.log(`SMOKE FAIL (${failures} failing check${failures > 1 ? "s" : ""})`);
  process.exit(1);
}
