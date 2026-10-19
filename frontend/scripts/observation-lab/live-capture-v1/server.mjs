import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))
const types = { ".html": "text/html; charset=utf-8" }
createServer(async (req, res) => {
  const p = req.url === "/" || req.url === "/self"
    ? "/self-capture.html"
    : null
  if (!p) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const b = await readFile(join(root, p))
    res.writeHead(200, { "Content-Type": types[extname(p)] })
    res.end(b)
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(4013, "127.0.0.1")
