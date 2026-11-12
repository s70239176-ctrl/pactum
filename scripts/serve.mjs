// Tiny static server for the war room: node scripts/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../frontend/", import.meta.url));
const types = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };
const port = Number(process.env.PORT ?? process.argv[2] ?? 5173);

createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).slice(1) || "index.html";
  const file = resolve(join(root, rel));
  if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`Pactum war room: http://localhost:${port}`));
