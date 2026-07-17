// Serveur HTTP local de controle - API JSON PURE (aucune UI servie ici).
// L'interface est l'application mobile React Native (dossier mobile/).
// --control-host 0.0.0.0 pour piloter depuis un telephone. CORS permissif.

const http = require("http");
const url = require("url");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

function startControlServer(node, port, host = "127.0.0.1") {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    const { pathname, query } = url.parse(req.url, true);
    try {
      if (req.method === "GET" && pathname === "/") {
        return send(res, 200, { name: "AttestP2P", api: "control",
          ui: "application mobile React Native (dossier mobile/)",
          routes: ["/status", "/peers", "/receive", "/messages?peer=",
                   "/connect", "/msg", "/send", "/upload", "/download", "/trust", "/ask"] });
      }
      if (req.method === "GET" && pathname === "/status") return send(res, 200, node.status());
      if (req.method === "GET" && pathname === "/peers") return send(res, 200, node.peersList());
      if (req.method === "GET" && pathname === "/receive") return send(res, 200, node.listAvailable());
      if (req.method === "GET" && pathname === "/messages") return send(res, 200, node.getThread(query.peer || ""));

      if (req.method === "POST") {
        const body = await readBody(req);
        if (pathname === "/connect") { node.connect(body.host || "127.0.0.1", Number(body.port)); return send(res, 200, { ok: true }); }
        if (pathname === "/msg") { const aiReply = await node.sendMessage(body.nodeId, body.text); return send(res, 200, { ok: true, aiReply }); }
        if (pathname === "/send") { return send(res, 200, node.sendFile(body.nodeId, body.filepath)); }
        if (pathname === "/upload") {
          const buf = Buffer.from(body.dataBase64 || "", "base64");
          return send(res, 200, node.uploadAndShare(body.nodeId, body.filename, buf));
        }
        if (pathname === "/download") { return send(res, 200, await node.download(body.file_id)); }
        if (pathname === "/trust") { return send(res, 200, { trusted: node.trustPeer(body.nodeId) }); }
        if (pathname === "/ask") { return send(res, 200, { reply: await node.askAI(body.nodeId, body.query) }); }
      }
      send(res, 404, { error: "route inconnue" });
    } catch (e) { send(res, 400, { error: e.message }); }
  });
  server.listen(port, host, () => console.log("Controle : API sur http://" + host + ":" + port));
  return server;
}

module.exports = { startControlServer };
