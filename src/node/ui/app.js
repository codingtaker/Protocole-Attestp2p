/* UI React d'Archipel (sans build : React UMD + htm, vendored localement). */
const { useState, useEffect, useRef } = React;
const html = htm.bind(React.createElement);

const api = (method, url, body) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    .then((r) => r.json()).catch((e) => ({ error: String(e) }));
const short = (h) => (h ? h.slice(0, 12) + "…" : "");

function Badges({ s }) {
  if (!s) return null;
  return html`<div class="badges">
    <span class="badge"><b>sessions</b> ${s.sessions}</span>
    <span class="badge"><b>pairs</b> ${s.peersDiscovered}</span>
    <span class="badge"><b>fichiers</b> ${s.filesLocal}/${s.filesAvailable}</span>
    <span class="badge"><b>trust</b> ${s.trusted}</span>
    <span class="badge"><b>IA</b> ${s.aiEnabled ? "on" : "off"}</span>
  </div>`;
}

function StatusTab({ s }) {
  if (!s) return html`<div class="muted">chargement…</div>`;
  const items = [
    ["Sessions actives", s.sessions], ["Pairs découverts", s.peersDiscovered],
    ["Fichiers locaux", s.filesLocal], ["Fichiers dispo.", s.filesAvailable],
    ["Pairs de confiance", s.trusted], ["Uptime (s)", s.uptimeSec],
  ];
  return html`<div class="card"><h2>Statut du nœud</h2>
    <div class="grid">${items.map(([k, v]) => html`<div class="stat" key=${k}><div class="k">${k}</div><div class="v">${v}</div></div>`)}</div>
    <p class="muted" style="margin-top:12px">node_id <span class="mono">${s.nodeId}</span></p>
    <p class="muted">TCP ${s.tcpPort} · secure ${s.securePort} · contrôle ${s.controlPort} · IA ${s.aiEnabled ? "activée" : "désactivée (--no-ai)"}</p>
  </div>`;
}

function PeersTab({ peers, reload, onChat }) {
  const [hp, setHp] = useState("");
  const connect = async () => { const i = hp.lastIndexOf(":"); await api("POST", "/connect", { host: hp.slice(0, i) || "127.0.0.1", port: Number(hp.slice(i + 1)) }); setHp(""); setTimeout(reload, 600); };
  const trust = async (id) => { await api("POST", "/trust", { nodeId: id }); reload(); };
  return html`<div class="card"><h2>Pairs</h2>
    <div class="row" style="margin-bottom:10px">
      <input placeholder="host:securePort (bootstrap)" value=${hp} onInput=${(e) => setHp(e.target.value)} style="flex:1"/>
      <button class="act" onClick=${connect}>Connecter</button>
    </div>
    ${(!peers || !peers.length) ? html`<div class="muted">aucun pair</div>` :
      peers.map((p) => html`<div class="peer" key=${p.nodeId}>
        <span class="mono">${short(p.nodeId)}</span>
        ${p.self ? html`<span class="tag">moi</span>` : null}
        ${p.connected ? html`<span class="tag">session</span>` : null}
        ${p.trusted ? html`<span class="tag">trust</span>` : null}
        <span style="margin-left:auto"></span>
        ${!p.self && p.connected ? html`<button class="ghost" onClick=${() => onChat(p.nodeId)}>Chat</button>` : null}
        ${!p.self && !p.trusted ? html`<button class="ghost" onClick=${() => trust(p.nodeId)}>Trust</button>` : null}
      </div>`)}
  </div>`;
}

function ChatTab({ peers, peer, setPeer }) {
  const [thread, setThread] = useState([]);
  const [text, setText] = useState("");
  const boxRef = useRef(null);
  const connected = (peers || []).filter((p) => p.connected && !p.self);

  const load = async () => { if (peer) setThread(await api("GET", "/messages?peer=" + encodeURIComponent(peer))); };
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [peer]);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [thread]);

  const send = async () => { if (!peer || !text.trim()) return; await api("POST", "/msg", { nodeId: peer, text }); setText(""); load(); };

  return html`<div class="card"><h2>Chat chiffré</h2>
    <div class="row" style="margin-bottom:10px">
      <select value=${peer || ""} onChange=${(e) => setPeer(e.target.value)}>
        <option value="">— choisir un pair connecté —</option>
        ${connected.map((p) => html`<option key=${p.nodeId} value=${p.nodeId}>${short(p.nodeId)}</option>`)}
      </select>
    </div>
    <div class="thread" ref=${boxRef}>
      ${thread.length ? thread.map((m, i) => html`<div class="msg ${m.dir}" key=${i}>${m.text}</div>`) : html`<div class="muted">aucun message</div>`}
    </div>
    <div class="row" style="margin-top:10px">
      <input placeholder="message… (astuce: /ask ou @archipel-ai pour l'IA)" value=${text}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && send()} style="flex:1" disabled=${!peer}/>
      <button class="act" onClick=${send} disabled=${!peer}>Envoyer</button>
    </div>
    <p class="muted" style="margin-top:6px">Les messages transitent chiffrés (XChaCha20-Poly1305). <code>/ask</code> ou <code>@archipel-ai</code> interroge l'assistant IA.</p>
  </div>`;
}

function FilesTab({ files, peers, reload }) {
  const [nodeId, setNodeId] = useState("");
  const [filepath, setFilepath] = useState("");
  const [busy, setBusy] = useState("");
  const connected = (peers || []).filter((p) => p.connected && !p.self);

  const share = async () => { setBusy("share"); const r = await api("POST", "/send", { nodeId, filepath }); setBusy(""); setFilepath(""); alert(r.error ? "Erreur: " + r.error : "Partagé — file_id " + r.file_id); setTimeout(reload, 500); };
  const download = async (id) => { setBusy(id); const r = await api("POST", "/download", { file_id: id }); setBusy(""); alert(r.error ? "Erreur: " + r.error : "Téléchargé: " + r.filename + " · SHA-256 conforme: " + r.matches); };

  return html`<div><div class="card"><h2>Partager un fichier</h2>
      <div class="row">
        <select value=${nodeId} onChange=${(e) => setNodeId(e.target.value)}>
          <option value="">— pair destinataire —</option>
          ${connected.map((p) => html`<option key=${p.nodeId} value=${p.nodeId}>${short(p.nodeId)}</option>`)}
        </select>
        <input placeholder="chemin du fichier (sur ce nœud)" value=${filepath} onInput=${(e) => setFilepath(e.target.value)} style="flex:1"/>
        <button class="act" onClick=${share} disabled=${!nodeId || !filepath || busy === "share"}>Partager</button>
      </div>
    </div>
    <div class="card"><h2>Fichiers disponibles</h2>
      ${(!files || !files.length) ? html`<div class="muted">aucun fichier annoncé</div>` :
        files.map((f) => html`<div class="peer" key=${f.file_id}>
          <div><div>${f.filename} <span class="muted">· ${f.size} o · ${f.nb_chunks} chunks</span></div>
            <div class="mono muted">${short(f.file_id)} · de ${f.from}</div></div>
          <span style="margin-left:auto"></span>
          <button class="ghost" onClick=${() => download(f.file_id)} disabled=${busy === f.file_id}>${busy === f.file_id ? "…" : "Télécharger"}</button>
        </div>`)}
    </div></div>`;
}

function App() {
  const [tab, setTab] = useState("status");
  const [status, setStatus] = useState(null);
  const [peers, setPeers] = useState([]);
  const [files, setFiles] = useState([]);
  const [peer, setPeer] = useState("");

  const reload = async () => {
    setStatus(await api("GET", "/status"));
    setPeers(await api("GET", "/peers"));
    setFiles(await api("GET", "/receive"));
  };
  useEffect(() => { reload(); const t = setInterval(reload, 2500); return () => clearInterval(t); }, []);

  const tabs = [["status", "Statut"], ["peers", "Pairs"], ["chat", "Chat"], ["files", "Fichiers"]];
  return html`<div>
    <header>
      <h1>🏝️ Archipel</h1>
      <span class="id">${status ? short(status.nodeId) : "…"}</span>
      <${Badges} s=${status}/>
    </header>
    <nav>${tabs.map(([k, l]) => html`<button key=${k} class=${tab === k ? "on" : ""} onClick=${() => setTab(k)}>${l}</button>`)}</nav>
    <main>
      ${tab === "status" ? html`<${StatusTab} s=${status}/>` : null}
      ${tab === "peers" ? html`<${PeersTab} peers=${peers} reload=${reload} onChat=${(id) => { setPeer(id); setTab("chat"); }}/>` : null}
      ${tab === "chat" ? html`<${ChatTab} peers=${peers} peer=${peer} setPeer=${setPeer}/>` : null}
      ${tab === "files" ? html`<${FilesTab} files=${files} peers=${peers} reload=${reload}/>` : null}
    </main>
  </div>`;
}

ReactDOM.createRoot(document.getElementById("root")).render(html`<${App}/>`);
