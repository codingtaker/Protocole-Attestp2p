// Module 4.1 — Serveur HTTP local de contrôle (API JSON) + UI React servie en
// statique (src/node/ui, React UMD + htm vendored, sans CDN au runtime).
// Écoute sur 127.0.0.1 uniquement.

const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");

const UI_DIR = path.join(__dirname, "ui");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json" };

function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
}
function serveStatic(res, rel) {
  const file = path.normalize(path.join(UI_DIR, rel));
  if (!file.startsWith(UI_DIR)) { res.writeHead(403); return res.end("forbidden"); } // anti-traversal
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

function startControlServer(node, port) {
  const server = http.createServer(async (req, res) => {
    const { pathname, query } = url.parse(req.url, true);
    try {
      // --- UI statique ---
      if (req.method === "GET" && pathname === "/") return serveStatic(res, "index.html");
      if (req.method === "GET" && pathname.startsWith("/ui/")) return serveStatic(res, pathname.slice(4));

      // --- API JSON ---
      if (req.method === "GET" && pathname === "/status") return send(res, 200, node.status());
      if (req.method === "GET" && pathname === "/peers") return send(res, 200, node.peersList());
      if (req.method === "GET" && pathname === "/receive") return send(res, 200, node.listAvailable());
      if (req.method === "GET" && pathname === "/messages") return send(res, 200, node.getThread(query.peer || ""));

      if (req.method === "POST") {
        const body = await readBody(req);
        if (pathname === "/connect") { node.connect(body.host || "127.0.0.1", Number(body.port)); return send(res, 200, { ok: true }); }
        if (pathname === "/msg") { const aiReply = await node.sendMessage(body.nodeId, body.text); return send(res, 200, { ok: true, aiReply }); }
        if (pathname === "/send") { return send(res, 200, node.sendFile(body.nodeId, body.filepath)); }
        if (pathname === "/download") { return send(res, 200, await node.download(body.file_id)); }
        if (pathname === "/trust") { return send(res, 200, { trusted: node.trustPeer(body.nodeId) }); }
        if (pathname === "/ask") { return send(res, 200, { reply: await node.askAI(body.nodeId, body.query) }); }
      }
      send(res, 404, { error: "route inconnue" });
    } catch (e) { send(res, 400, { error: e.message }); }
  });
  server.listen(port, "127.0.0.1", () => console.log("🕹  Contrôle + UI React sur http://127.0.0.1:" + port));
  return server;
}

module.exports = { startControlServer };
