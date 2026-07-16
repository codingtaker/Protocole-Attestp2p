#!/usr/bin/env node
// Module 4.1 — CLI Archipel.
//   archipel start [--port 7778] [--tcp 7777] [--control 8778] [--data DIR] [--no-ai] [--connect host:port ...]
//   archipel peers | status | receive
//   archipel msg <node_id> "texte"        (message chiffré ; /ask ou @archipel-ai → IA)
//   archipel send <node_id> <filepath>    (partage un fichier)
//   archipel download <file_id>
//   archipel trust <node_id>              (Web of Trust)
//   archipel connect <host:port>          (bootstrap sans multicast)
//   archipel ask <node_id> "question"     (IA contextuelle)
// Les commandes autres que "start" parlent à l'API de contrôle du nœud
// (port lu dans <data>/runtime.json).

const fs = require("fs");
const path = require("path");
const http = require("http");

const argv = process.argv.slice(2);
const cmd = argv[0];

function getFlag(name, def) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
}
function getAll(name) {
  const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === "--" + name && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}
const hasFlag = (name) => argv.includes("--" + name);
const dataDir = path.resolve(getFlag("data", path.join(process.cwd(), ".archipel")));

function api(method, route, body) {
  let rt; try { rt = JSON.parse(fs.readFileSync(path.join(dataDir, "runtime.json"), "utf8")); }
  catch { console.error("Nœud introuvable. Lancez d'abord: archipel start (ou précisez --data)."); process.exit(1); }
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port: rt.controlPort, path: route, method,
      headers: { "Content-Type": "application/json", "Content-Length": data ? Buffer.byteLength(data) : 0 } },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const short = (h) => (h ? h.slice(0, 16) + "…" : h);

(async () => {
  if (cmd === "start") {
    // Identité et secret HMAC fixés AVANT de charger la config/les clés.
    process.env.IDENTITY_FILE = process.env.IDENTITY_FILE || path.join(dataDir, "identity.key");
    process.env.HMAC_SECRET = process.env.HMAC_SECRET || "archipel";
    const fsx = require("fs"); fsx.mkdirSync(dataDir, { recursive: true });
    const { ArchipelNode } = require("../src/node/archipelNode");
    const node = new ArchipelNode({
      securePort: Number(getFlag("port", 7778)),
      tcpPort: Number(getFlag("tcp", 7777)),
      controlPort: Number(getFlag("control", 0)) || undefined,
      dataDir, noAi: hasFlag("no-ai"), bootstrap: getAll("connect"),
    });
    await node.start();
    const s = node.status();
    console.log("🏝️  Nœud Archipel démarré");
    console.log("   node_id     : " + s.nodeId);
    console.log("   secure/tcp  : " + s.securePort + " / " + s.tcpPort);
    console.log("   contrôle+UI : http://127.0.0.1:" + s.controlPort);
    console.log("   IA (Gemini) : " + (s.aiEnabled ? "activée" : "désactivée (--no-ai)"));
    console.log("   data        : " + dataDir);
    console.log("   (Ctrl+C pour arrêter)");
    process.on("SIGINT", () => { node.stop(); process.exit(0); });
    return;
  }

  if (cmd === "peers") {
    const ps = await api("GET", "/peers");
    if (!ps.length) return console.log("(aucun pair)");
    for (const p of ps) console.log(short(p.nodeId) + (p.self ? " [moi]" : "") + (p.connected ? " [session]" : "") + (p.trusted ? " [trust]" : "") + "  " + (p.address || ""));
    return;
  }
  if (cmd === "status") { console.log(JSON.stringify(await api("GET", "/status"), null, 2)); return; }
  if (cmd === "receive") {
    const fsv = await api("GET", "/receive");
    if (!fsv.length) return console.log("(aucun fichier disponible)");
    for (const f of fsv) console.log(f.file_id + "  " + f.filename + "  " + f.size + " o  (de " + f.from + ")");
    return;
  }
  if (cmd === "msg") {
    const nodeId = argv[1]; const text = argv.slice(2).join(" ");
    const r = await api("POST", "/msg", { nodeId, text });
    console.log(r.error ? "Erreur: " + r.error : "✔ message envoyé" + (r.aiReply ? "\nIA: " + r.aiReply : ""));
    return;
  }
  if (cmd === "send") {
    const r = await api("POST", "/send", { nodeId: argv[1], filepath: path.resolve(argv[2]) });
    console.log(r.error ? "Erreur: " + r.error : "✔ fichier partagé — file_id " + r.file_id + " (" + r.nb_chunks + " chunks)");
    return;
  }
  if (cmd === "download") {
    const r = await api("POST", "/download", { file_id: argv[1] });
    console.log(r.error ? "Erreur: " + r.error : "✔ téléchargé: " + r.filename + " — SHA-256 conforme: " + r.matches);
    return;
  }
  if (cmd === "trust") { const r = await api("POST", "/trust", { nodeId: argv[1] }); console.log("✔ pairs approuvés: " + (r.trusted || []).map(short).join(", ")); return; }
  if (cmd === "connect") { const [h, p] = argv[1].split(":"); await api("POST", "/connect", { host: h, port: Number(p) }); console.log("✔ connexion demandée vers " + argv[1]); return; }
  if (cmd === "ask") { const r = await api("POST", "/ask", { nodeId: argv[1], query: argv.slice(2).join(" ") }); console.log("IA: " + r.reply); return; }

  console.log("Commandes: start | peers | status | receive | msg | send | download | trust | connect | ask");
  process.exit(cmd ? 1 : 0);
})().catch((e) => { console.error("Erreur:", e.message); process.exit(1); });
