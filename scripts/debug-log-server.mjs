import { createServer } from "node:http";
import { mkdir, appendFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.BRIDGE_DEBUG_HOST ?? "127.0.0.1";
const port = Number(process.env.BRIDGE_DEBUG_PORT ?? 17761);
const logPath = resolve(process.env.BRIDGE_DEBUG_LOG ?? "tmp/bridge-debug/events.jsonl");
const maxLogBytes = Number(process.env.BRIDGE_DEBUG_LOG_MAX_BYTES ?? 5 * 1024 * 1024);
const maxLogBackups = Number(process.env.BRIDGE_DEBUG_LOG_MAX_BACKUPS ?? 3);

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function send(response, statusCode, body = "") {
  response.writeHead(statusCode, {
    ...corsHeaders,
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : null;
}

async function pathSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function rotateLogIfNeeded(filePath, incomingBytes, { maxBytes, maxBackups }) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return;
  }

  const currentSize = await pathSize(filePath);
  if (currentSize === 0 || currentSize + incomingBytes <= maxBytes) {
    return;
  }

  const backups = Math.max(0, Math.floor(Number(maxBackups) || 0));
  if (backups === 0) {
    await rm(filePath, { force: true });
    return;
  }

  await rm(`${filePath}.${backups}`, { force: true });
  for (let index = backups - 1; index >= 1; index -= 1) {
    try {
      await rename(`${filePath}.${index}`, `${filePath}.${index + 1}`);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  try {
    await rename(filePath, `${filePath}.1`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function appendRotatingJsonLine(
  filePath,
  payload,
  { maxBytes = maxLogBytes, maxBackups = maxLogBackups } = {}
) {
  const line = `${JSON.stringify(payload)}\n`;
  await mkdir(dirname(filePath), { recursive: true });
  await rotateLogIfNeeded(filePath, Buffer.byteLength(line, "utf8"), {
    maxBytes,
    maxBackups
  });
  await appendFile(filePath, line, "utf8");
}

export function createDebugLogServer() {
  return createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      send(response, 204);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, "ok\n");
      return;
    }

    if (request.method !== "POST" || request.url !== "/events") {
      send(response, 404, "not found\n");
      return;
    }

    const event = await readJsonBody(request);
    await appendRotatingJsonLine(logPath, {
      receivedAt: new Date().toISOString(),
      event
    });
    send(response, 204);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, 500, `${message}\n`);
  }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDebugLogServer();
  server.listen(port, host, () => {
    console.log(`Bridge debug log server listening at http://${host}:${port}/events`);
    console.log(`Writing JSONL events to ${logPath}`);
    console.log(`Rotating at ${maxLogBytes} bytes with ${maxLogBackups} backups`);
  });
}
