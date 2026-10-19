import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"

const root = new URL(".", import.meta.url).pathname
createServer(async (_req, res) => {
  try {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(await readFile(join(root, "self-capture.html")))
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(4014, "127.0.0.1")
