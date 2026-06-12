#!/usr/bin/env node
/**
 * tdl-mcp — MCP stdio server wrapping the locally-installed `tdl` CLI
 * (https://github.com/iyear/tdl, a user-session MTProto Telegram client).
 * https://github.com/rixile9999/tdl-mcp
 *
 * Read-only by design: lists chats, exports message metadata/text, downloads
 * media. It never sends messages and never invokes `tdl login` (login is
 * interactive; run `tdl login -T qr` in a terminal yourself, once).
 *
 * Env:
 *   TDL_BIN — path to the tdl binary (default: `tdl` on PATH, falling back
 *             to /opt/homebrew/bin/tdl for GUI-launched hosts without brew PATH)
 *   TDL_NS  — tdl namespace, passed as `-n <ns>` on every call
 */

import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// tdl binary resolution + runner
// ---------------------------------------------------------------------------

const HOMEBREW_TDL = "/opt/homebrew/bin/tdl";

function resolveTdlBin() {
  if (process.env.TDL_BIN) return process.env.TDL_BIN;
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      accessSync(path.join(dir, "tdl"), fsConstants.X_OK);
      return "tdl"; // found on PATH
    } catch {
      /* keep looking */
    }
  }
  return HOMEBREW_TDL;
}

const TDL_BIN = resolveTdlBin();

const TIMEOUT_LIST = 120_000; // listing-style calls
const TIMEOUT_HEAVY = 600_000; // export / download calls
const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB

/**
 * Run tdl with an argument array (execFile — no shell, no injection).
 * Resolves {stdout, stderr}; rejects with an Error whose message includes the
 * tail of tdl's output (tdl prints errors to STDOUT, so include both streams).
 */
function runTdl(args, { timeoutMs = TIMEOUT_LIST } = {}) {
  const nsArgs = process.env.TDL_NS ? ["-n", process.env.TDL_NS] : [];
  const fullArgs = [...nsArgs, ...args];
  return new Promise((resolve, reject) => {
    execFile(
      TDL_BIN,
      fullArgs,
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER, killSignal: "SIGTERM" },
      (err, stdout, stderr) => {
        if (err) {
          const tail = (s) => String(s || "").trim().slice(-2000);
          const detail = [tail(stderr), tail(stdout)]
            .filter(Boolean)
            .join("\n");
          const timedOut = err.killed || err.signal === "SIGTERM";
          reject(
            new Error(
              `tdl ${args.join(" ")} failed${timedOut ? " (timeout)" : ""}: ` +
                (detail || err.message)
            )
          );
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const jsonResult = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
});

const errorResult = (message) => ({
  content: [{ type: "text", text: String(message) }],
  isError: true,
});

function expandDest(dest) {
  let d = dest || path.join(os.homedir(), "Downloads", "telegram");
  if (d === "~") d = os.homedir();
  else if (d.startsWith("~/")) d = path.join(os.homedir(), d.slice(2));
  return path.resolve(d);
}

function tmpExportPath() {
  return path.join(
    os.tmpdir(),
    `tdl-export-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`
  );
}

async function rmQuiet(file) {
  try {
    await fsp.rm(file, { force: true });
  } catch {
    /* best effort */
  }
}

/** Recursively list files under dir as a Set of absolute paths. */
async function snapshotFiles(dir) {
  const out = new Set();
  async function walk(d) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.isFile()) out.add(p);
    }
  }
  await walk(dir);
  return out;
}

function diffSnapshot(before, after) {
  return [...after].filter((p) => !before.has(p)).sort();
}

/** Build the chat-export range args shared by tg_messages / tg_download. */
function rangeArgs({ since_id, last_n }) {
  if (since_id !== undefined && since_id !== null) {
    return ["-T", "id", "-i", `${since_id + 1},999999999`];
  }
  return ["-T", "last", "-i", String(last_n)];
}

/** Defensive: the export JSON is {messages:[...]} but tolerate a bare array. */
function exportMessages(data) {
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data)) return data;
  return [];
}

function parseExtensions(extensions) {
  if (!extensions) return null;
  const exts = extensions
    .split(",")
    .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  return exts.length > 0 ? exts : null;
}

/** Does the export contain any .file entry matching the extension filter?
 *  `exts` is the parseExtensions() result (normalized array or null). */
function hasMatchingFiles(data, exts) {
  return exportMessages(data).some((m) => {
    const f = typeof m?.file === "string" ? m.file : "";
    if (!f) return false;
    if (!exts) return true;
    return exts.includes(path.extname(f).slice(1).toLowerCase());
  });
}

/** Run `tdl chat ls -o json` and return the parsed array. */
async function listChats(timeoutMs) {
  const { stdout } = await runTdl(["chat", "ls", "-o", "json"], { timeoutMs });
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `tdl chat ls returned non-JSON output: ${stdout.trim().slice(-500)}`
    );
  }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.chats)) return parsed.chats;
  return [];
}

/** Pick a display name from whatever fields the tdl JSON actually carries. */
function chatName(c) {
  for (const k of ["visible_name", "name", "title", "first_name"]) {
    if (typeof c?.[k] === "string" && c[k] !== "") return c[k];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------------

const pkg = createRequire(import.meta.url)("./package.json");

const server = new McpServer({ name: "tdl-mcp", version: pkg.version });

server.registerTool(
  "tg_status",
  {
    title: "Telegram session status",
    description:
      "Check whether the local tdl Telegram session is logged in and usable. " +
      "Call this first if another tg_* tool fails or before starting Telegram work. " +
      "Never errors — returns {logged_in:false, hint} when the session is missing.",
    inputSchema: {},
  },
  async () => {
    try {
      const chats = await listChats(20_000);
      return jsonResult({ logged_in: true, chats: chats.length });
    } catch (err) {
      return jsonResult({
        logged_in: false,
        hint:
          "run `tdl login -T qr` in a terminal (interactive QR login), then retry",
        error: String(err.message || err).slice(0, 500),
      });
    }
  }
);

server.registerTool(
  "tg_chats",
  {
    title: "List Telegram chats",
    description:
      "List the Telegram dialogs (chats/channels/groups/users) visible to the " +
      "logged-in session, as [{id, type, name, username}]. Use it to find the " +
      "chat id or @username to pass as `chat` to tg_messages / tg_download. " +
      "Optional `filter` does a case-insensitive substring match on name/username/id.",
    inputSchema: {
      filter: z
        .string()
        .optional()
        .describe(
          "Case-insensitive substring to match against chat name, username or id"
        ),
    },
  },
  async ({ filter }) => {
    const chats = await listChats(TIMEOUT_LIST);
    const needle = filter ? filter.toLowerCase() : null;
    const mapped = chats
      .map((c) => {
        const entry = {
          id: c?.id,
          type: c?.type,
          name: chatName(c),
          username:
            typeof c?.username === "string" && c.username !== ""
              ? c.username
              : undefined,
        };
        for (const k of Object.keys(entry)) {
          if (entry[k] === undefined || entry[k] === null) delete entry[k];
        }
        return entry;
      })
      .filter((c) => {
        if (!needle) return true;
        return [c.name, c.username, c.id, c.type]
          .filter((v) => v !== undefined && v !== null)
          .some((v) => String(v).toLowerCase().includes(needle));
      });
    return jsonResult({ count: mapped.length, chats: mapped });
  }
);

server.registerTool(
  "tg_messages",
  {
    title: "Read recent Telegram messages",
    description:
      "Export recent media messages from one chat (by id or @username) and return " +
      "them as compact {id, date, file, text} objects — newest range exported via " +
      "tdl. Use last_n for 'the last N media messages', or since_id to fetch only " +
      "messages after a known message id (incremental reads). Read-only.",
    inputSchema: {
      chat: z
        .string()
        .describe("Chat id or @username/domain (as shown by tg_chats)"),
      last_n: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("How many recent media messages to export (default 50, max 500)"),
      since_id: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Only messages with id > since_id (overrides last_n; for incremental reads)"
        ),
      with_text: z
        .boolean()
        .optional()
        .describe("Include message text content (default true)"),
    },
  },
  async ({ chat, last_n, since_id, with_text }) => {
    const tmp = tmpExportPath();
    try {
      const args = [
        "chat",
        "export",
        "-c",
        chat,
        ...rangeArgs({ since_id, last_n: last_n ?? 50 }),
        "-o",
        tmp,
      ];
      if (with_text !== false) args.push("--with-content");
      await runTdl(args, { timeoutMs: TIMEOUT_HEAVY });

      const data = JSON.parse(await fsp.readFile(tmp, "utf8"));
      const all = exportMessages(data);
      const LIMIT = 200;
      const messages = all.slice(0, LIMIT).map((m) => {
        const entry = { id: m?.id, date: m?.date, file: m?.file, text: m?.text };
        for (const k of Object.keys(entry)) {
          if (entry[k] === undefined || entry[k] === null || entry[k] === "") {
            delete entry[k];
          }
        }
        return entry;
      });
      const result = {
        chat,
        total_exported: all.length,
        returned: messages.length,
        messages,
      };
      if (all.length > LIMIT) {
        result.note = `truncated: ${all.length} messages exported, returning the first ${LIMIT}`;
      }
      return jsonResult(result);
    } catch (err) {
      return errorResult(String(err.message || err));
    } finally {
      await rmQuiet(tmp);
    }
  }
);

server.registerTool(
  "tg_download",
  {
    title: "Download Telegram media from a chat",
    description:
      "Download media files from one chat (by id or @username) to a local directory " +
      "and return the absolute paths of newly downloaded files. Use extensions " +
      "(csv, e.g. 'xlsx,pdf') to fetch only certain file types; since_id for " +
      "'everything new after message X'; last_n for 'the latest N media messages' " +
      "(default 100). Already-present files are skipped (--skip-same).",
    inputSchema: {
      chat: z
        .string()
        .describe("Chat id or @username/domain (as shown by tg_chats)"),
      since_id: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Only messages with id > since_id (overrides last_n)"),
      last_n: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("How many recent media messages to consider (default 100)"),
      extensions: z
        .string()
        .optional()
        .describe("Comma-separated file extensions to include, e.g. 'xlsx,pdf'"),
      dest: z
        .string()
        .optional()
        .describe("Destination directory (default ~/Downloads/telegram)"),
    },
  },
  async ({ chat, since_id, last_n, extensions, dest }) => {
    // Normalize the extension csv once (strip dots/spaces, lowercase) so the
    // value handed to `tdl dl -i` matches what hasMatchingFiles checks. tdl
    // compares bare extensions ("xlsx"), so a raw ".xlsx, .pdf" would
    // silently match nothing.
    const exts = parseExtensions(extensions);
    if (extensions && !exts) {
      return errorResult(
        `invalid extensions: ${JSON.stringify(extensions)} — expected a csv like "xlsx,pdf"`
      );
    }
    const destDir = expandDest(dest);
    const tmp = tmpExportPath();
    try {
      await runTdl(
        [
          "chat",
          "export",
          "-c",
          chat,
          ...rangeArgs({ since_id, last_n: last_n ?? 100 }),
          "-o",
          tmp,
        ],
        { timeoutMs: TIMEOUT_HEAVY }
      );

      let exportData = null;
      try {
        exportData = JSON.parse(await fsp.readFile(tmp, "utf8"));
      } catch {
        /* defensive — treated as "unknown contents" below */
      }

      await fsp.mkdir(destDir, { recursive: true });
      const before = await snapshotFiles(destDir);

      const dlArgs = ["dl", "-f", tmp];
      if (exts) dlArgs.push("-i", exts.join(","));
      dlArgs.push("-d", destDir, "--skip-same");

      try {
        await runTdl(dlArgs, { timeoutMs: TIMEOUT_HEAVY });
      } catch (err) {
        if (exportData !== null && !hasMatchingFiles(exportData, exts)) {
          return jsonResult({
            downloaded: [],
            note:
              "no matching files: the exported message range contains no files" +
              (extensions ? ` with extension(s) ${extensions}` : ""),
          });
        }
        return errorResult(String(err.message || err));
      }

      const after = await snapshotFiles(destDir);
      const downloaded = diffSnapshot(before, after);
      const result = { dest: destDir, downloaded };
      if (downloaded.length === 0) {
        result.note =
          "no new files: everything was skipped as already present (--skip-same) " +
          "or nothing in the range matched";
      }
      return jsonResult(result);
    } catch (err) {
      return errorResult(String(err.message || err));
    } finally {
      await rmQuiet(tmp);
    }
  }
);

server.registerTool(
  "tg_download_url",
  {
    title: "Download Telegram media by t.me link",
    description:
      "Download the media of specific Telegram messages given their t.me links " +
      "(e.g. https://t.me/channel/123) and return the absolute paths of newly " +
      "downloaded files. Use when you already have message links rather than a " +
      "chat to scan. Already-present files are skipped (--skip-same).",
    inputSchema: {
      urls: z
        .array(z.string())
        .min(1)
        .describe("Telegram message links; each must start with https://t.me/"),
      extensions: z
        .string()
        .optional()
        .describe("Comma-separated file extensions to include, e.g. 'xlsx,pdf'"),
      dest: z
        .string()
        .optional()
        .describe("Destination directory (default ~/Downloads/telegram)"),
    },
  },
  async ({ urls, extensions, dest }) => {
    const invalid = urls.filter((u) => !u.startsWith("https://t.me/"));
    if (invalid.length > 0) {
      return errorResult(
        `invalid url(s) — every url must start with https://t.me/ : ${invalid.join(", ")}`
      );
    }
    const exts = parseExtensions(extensions);
    if (extensions && !exts) {
      return errorResult(
        `invalid extensions: ${JSON.stringify(extensions)} — expected a csv like "xlsx,pdf"`
      );
    }

    const destDir = expandDest(dest);
    try {
      await fsp.mkdir(destDir, { recursive: true });
      const before = await snapshotFiles(destDir);

      const dlArgs = ["dl", ...urls.flatMap((u) => ["-u", u])];
      if (exts) dlArgs.push("-i", exts.join(","));
      dlArgs.push("-d", destDir, "--skip-same");
      await runTdl(dlArgs, { timeoutMs: TIMEOUT_HEAVY });

      const after = await snapshotFiles(destDir);
      const downloaded = diffSnapshot(before, after);
      const result = { dest: destDir, downloaded };
      if (downloaded.length === 0) {
        result.note =
          "no new files: everything was skipped as already present (--skip-same) " +
          "or no media matched the extension filter";
      }
      return jsonResult(result);
    } catch (err) {
      return errorResult(String(err.message || err));
    }
  }
);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the MCP protocol channel — log to stderr only.
console.error(`telegram-mcp ready (tdl: ${TDL_BIN})`);
