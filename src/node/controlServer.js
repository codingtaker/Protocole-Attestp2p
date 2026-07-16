// Module 4.1 — Serveur HTTP local de contrôle (API JSON) + UI web minimale.
// Écoute sur 127.0.0.1 uniquement. Consommé par la CLI et par la page web.

const http = require("http");
const url = require("url");

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

function startControlServer(node, port) {
  const server = http.createServer(async (req, res) => {
    const { pathname, query } = url.parse(req.url, true);
    try {
      if (req.method === "GET" && pathname === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(UI_HTML); }
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
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  });
  server.listen(port, "127.0.0.1", () => console.log("🕹  Contrôle HTTP + UI sur http://127.0.0.1:" + port));
  return server;
}

const UI_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archipel — nœud</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;background:#0f1720;color:#e5e9f0}
 header{padding:12px 18px;background:#111c2b;border-bottom:1px solid #22303f}
 h1{font-size:16px;margin:0} .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px}
 .card{background:#111c2b;border:1px solid #22303f;border-radius:10px;padding:12px}
 .card h2{font-size:13px;margin:0 0 8px;color:#8fb3ff;text-transform:uppercase;letter-spacing:.5px}
 code,input,button{font-family:ui-monospace,monospace}
 input{background:#0b131c;border:1px solid #2a3a4d;color:#e5e9f0;padding:6px;border-radius:6px}
 button{background:#2b6cff;color:#fff;border:0;padding:6px 10px;border-radius:6px;cursor:pointer}
 .row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap} .mono{font-family:ui-monospace,monospace;font-size:12px}
 pre{white-space:pre-wrap;word-break:break-all;background:#0b131c;padding:8px;border-radius:6px;max-height:220px;overflow:auto}
 .peer{padding:4px 0;border-bottom:1px solid #1b2836} .tag{font-size:10px;padding:1px 5px;border-radius:4px;background:#22303f;margin-left:6px}
</style></head><body>
<header><h1>🏝️ Archipel — panneau du nœud</h1></header>
<div class="grid">
 <div class="card"><h2>Statut</h2><pre id="status">…</pre></div>
 <div class="card"><h2>Pairs</h2><div id="peers"></div></div>
 <div class="card"><h2>Chat chiffré</h2>
   <div class="row"><input id="peer" placeholder="node_id" size="24"><input id="text" placeholder="message ou /ask …" style="flex:1"></div>
   <div class="row"><button onclick="sendMsg()">Envoyer</button><button onclick="loadThread()">Rafraîchir fil</button></div>
   <pre id="thread"></pre>
 </div>
 <div class="card"><h2>Fichiers disponibles</h2><div id="files"></div>
   <div class="row"><input id="fid" placeholder="file_id" style="flex:1"><button onclick="dl()">Télécharger</button></div>
 </div>
</div>
<script>
const j=(u,m,b)=>fetch(u,{method:m||'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
async function refresh(){
 document.getElementById('status').textContent=JSON.stringify(await j('/status'),null,2);
 const ps=await j('/peers');document.getElementById('peers').innerHTML=ps.map(p=>'<div class="peer mono">'+p.nodeId.slice(0,16)+'…'+(p.self?'<span class=tag>moi</span>':'')+(p.connected?'<span class=tag>session</span>':'')+(p.trusted?'<span class=tag>trust</span>':'')+'</div>').join('')||'<i>aucun</i>';
 const fs=await j('/receive');document.getElementById('files').innerHTML=fs.map(f=>'<div class="peer mono">'+f.filename+' — '+f.size+' o — '+f.file_id.slice(0,16)+'…</div>').join('')||'<i>aucun</i>';
}
async function sendMsg(){const nodeId=peer.value,text=document.getElementById('text').value;const r=await j('/msg','POST',{nodeId,text});if(r.aiReply)alert('IA: '+r.aiReply);document.getElementById('text').value='';loadThread();}
async function loadThread(){const t=await j('/messages?peer='+encodeURIComponent(peer.value));document.getElementById('thread').textContent=t.map(m=>'['+m.dir+'] '+m.text).join('\\n');}
async function dl(){const r=await j('/download','POST',{file_id:fid.value});alert('Téléchargé: '+r.filename+' matches='+r.matches);}
refresh();setInterval(refresh,3000);
</script></body></html>`;

module.exports = { startControlServer };
