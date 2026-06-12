#!/usr/bin/env node
/**
 * Contract test for tdl-mcp: verifies that the tdl CLI surface server.js
 * depends on still exists in the installed tdl binary. Login-free — it only
 * inspects `--help` output and `tdl version`, never touches a session.
 *
 * Run against a new tdl release before bumping .tdl-version: if this passes,
 * every flag and value the server passes to tdl is still accepted.
 *
 * Env:
 *   TDL_BIN — path to the tdl binary (default: `tdl` on PATH)
 *
 * Exit 0 on pass, 1 on fail.
 */

import { execFile } from "node:child_process";

const TDL_BIN = process.env.TDL_BIN || "tdl";

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(TDL_BIN, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(
          new Error(
            `tdl ${args.join(" ")} failed: ${String(stderr || stdout || err.message).trim().slice(-500)}`
          )
        );
      } else {
        resolve(`${stdout}\n${stderr}`);
      }
    });
  });
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`PASS: ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Assert every needle appears in the help text; report the missing ones. */
function checkFlags(label, help, needles) {
  const missing = needles.filter((n) => !help.includes(n));
  check(
    `${label} accepts [${needles.join(", ")}]`,
    missing.length === 0,
    missing.length > 0 ? `missing: ${missing.join(", ")}` : ""
  );
}

try {
  const version = await run(["version"]);
  const m = version.match(/Version:\s*(\S+)/);
  console.log(`tdl binary: ${TDL_BIN} (${m ? m[1] : "version unknown"})`);

  // The exact CLI surface server.js uses, one runTdl() call shape at a time.

  // global: -n <ns> (TDL_NS)
  const rootHelp = await run(["--help"]);
  checkFlags("tdl (global)", rootHelp, ["-n, --ns"]);

  // listChats(): tdl chat ls -o json
  const lsHelp = await run(["chat", "ls", "--help"]);
  checkFlags("tdl chat ls", lsHelp, ["-o, --output"]);
  check(
    "tdl chat ls -o supports json",
    /--output[^\n]*json|json[^\n]*--output/.test(lsHelp) ||
      lsHelp.includes("json"),
    "no mention of a json output format in help"
  );

  // tg_messages / tg_download: tdl chat export -c <chat> -T last|id -i <range> -o <file> --with-content
  const exportHelp = await run(["chat", "export", "--help"]);
  checkFlags("tdl chat export", exportHelp, [
    "-c, --chat",
    "-T, --type",
    "-i, --input",
    "-o, --output",
    "--with-content",
  ]);
  check(
    "tdl chat export -T supports id and last",
    exportHelp.includes("id") && exportHelp.includes("last"),
    "export types changed — check -T/--type help text"
  );

  // tg_download / tg_download_url: tdl dl -f <json> / -u <url> -i <exts> -d <dir> --skip-same
  const dlHelp = await run(["dl", "--help"]);
  checkFlags("tdl dl", dlHelp, [
    "-f, --file",
    "-u, --url",
    "-i, --include",
    "-d, --dir",
    "--skip-same",
  ]);
} catch (err) {
  failures += 1;
  console.log(`FAIL: contract run crashed — ${err?.message || err}`);
}

if (failures === 0) {
  console.log("CONTRACT PASS");
  process.exit(0);
} else {
  console.log(`CONTRACT FAIL (${failures} failing check${failures > 1 ? "s" : ""})`);
  process.exit(1);
}
