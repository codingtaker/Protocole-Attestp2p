// Noeud AttestP2P : assemble identite, serveur de sessions chiffrees, discovery,
// PeerManager, transfert de fichiers (FileNode), chat chiffre, Web of Trust, et
// l'assistant IA contextuel (Gemini, isole et desactivable).
//
// Multiplexage sur une meme session chiffree :
//   octet de tete 0x10..0x15 -> protocole fichier ; 0x20 -> chat.

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const { initKeys, getPublicKey } = require("../crypto/keys");
const { startSecureServer } = require("../network/secureServer");
const { connectSecure } = require("../network/secureClient");
const { startDiscovery } = require("../network/udpDiscovery");
const { PeerManager } = require("../session/peerManager");
const { ChunkStore } = require("../file/chunkStore");
const { FileNode } = require("../file/fileNode");
const { buildManifest } = require("../file/manifest");
const { TrustStore } = require("./trustStore");
const { IpRateLimiter } = require("../network/ipRateLimiter");

const CHAT = 0x20;
const AI_CONTEXT_MESSAGES = Number(process.env.AI_CONTEXT_MESSAGES) || 10;
// Sessions authentifiees de l'appli : debit eleve, per-IP releve (bulk/chat).
const SESSION_OPT = { maxMsgPerSecond: 1e6, rekeyPolicy: { everyMsgs: 1e9, everyBytes: 1e15, everyMs: 1e9 },
  ipRateLimiter: new IpRateLimiter(1e6, 1000) };

class AttestP2PNode extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.securePort = opts.securePort || 7778;
    this.tcpPort = opts.tcpPort || 7777;
    this.controlPort = opts.controlPort || (this.securePort + 1000);
    this.controlHost = opts.controlHost || "127.0.0.1";
    this.dataDir = opts.dataDir || path.join(process.cwd(), ".attestp2p");
    this.downloadDir = opts.downloadDir || path.join(this.dataDir, "downloads");
    this.noAi = !!opts.noAi;
    this.bootstrap = opts.bootstrap || [];
    this.startedAt = Date.now();

    this.sessionsByPeer = new Map(); // nodeIdHex -> SecureConnection
    this.threads = new Map();        // nodeIdHex -> [{dir,text,ts}]
    this.availableFiles = {};        // file_id -> { manifest, from }
  }

  async start() {
    fs.mkdirSync(this.downloadDir, { recursive: true });
    await initKeys();
    this.selfId = getPublicKey();
    this.selfHex = this.selfId.toString("hex");

    this.store = new ChunkStore(path.join(this.dataDir, "chunks"));
    this.fileNode = new FileNode({ store: this.store });
    this.trust = new TrustStore(path.join(this.dataDir, "trust.json"));

    this.fileNode.on("manifest", (m) => {
      this.availableFiles[m.file_id] = { manifest: m, from: m.sender_id.slice(0, 8) };
      this.emit("file-available", m);
    });

    this.secureServer = startSecureServer(this.securePort,
      (conn) => conn.on("secure", () => this._attach(conn)), SESSION_OPT);

    this.discovery = startDiscovery({ nodeId: this.selfId, tcpPort: this.tcpPort, securePort: this.securePort });
    this.peers = new PeerManager({
      selfId: this.selfId,
      discovery: this.discovery,
      connect: (p, h, cb) => connectSecure(p, h, cb, SESSION_OPT),
      onSession: (conn) => this._attach(conn),
    }).start();

    for (const hp of this.bootstrap) {
      const i = hp.lastIndexOf(":");
      this.connect(hp.slice(0, i), Number(hp.slice(i + 1)));
    }

    const { startControlServer } = require("./controlServer");
    this.control = startControlServer(this, this.controlPort, this.controlHost);

    fs.writeFileSync(path.join(this.dataDir, "runtime.json"), JSON.stringify({
      nodeId: this.selfHex, tcpPort: this.tcpPort, securePort: this.securePort,
      controlPort: this.controlPort, controlHost: this.controlHost, pid: process.pid,
    }, null, 2));

    return this;
  }

  connect(host, port) {
    return connectSecure(port, host, (conn) => this._attach(conn), SESSION_OPT);
  }

  _attach(conn) {
    const peerHex = conn.peerId.toString("hex");
    this.sessionsByPeer.set(peerHex, conn);
    this.fileNode.attachSession(conn, { manageListener: false });
    conn.on("message", (buf) => this._route(conn, buf));
    conn.on("close", () => { if (this.sessionsByPeer.get(peerHex) === conn) this.sessionsByPeer.delete(peerHex); });
    this.emit("peer-connected", peerHex);
  }

  _route(conn, buf) {
    const t = buf[0];
    if (t >= 0x10 && t <= 0x15) return this.fileNode.handleMessage(conn, buf);
    if (t === CHAT) return this._onChat(conn, buf.subarray(1));
  }

  _thread(peerHex) {
    if (!this.threads.has(peerHex)) this.threads.set(peerHex, []);
    return this.threads.get(peerHex);
  }

  _onChat(conn, textBuf) {
    const peerHex = conn.peerId.toString("hex");
    const text = textBuf.toString();
    this._thread(peerHex).push({ dir: "in", text, ts: Date.now() });
    this.emit("chat", { peer: peerHex, text });
    if (this._isAiTrigger(text)) this.askAI(peerHex, this._stripTrigger(text)).catch(() => {});
  }

  _isAiTrigger(t) { return /@attestp2p-ai\b/.test(t) || /^\s*\/ask\b/.test(t); }
  _stripTrigger(t) { return t.replace(/@attestp2p-ai/g, "").replace(/^\s*\/ask\s*/, "").trim(); }

  sendMessage(nodeIdHex, text) {
    const conn = this.sessionsByPeer.get(nodeIdHex);
    if (!conn) throw new Error("pas de session ouverte avec " + nodeIdHex.slice(0, 8));
    conn.send(Buffer.concat([Buffer.from([CHAT]), Buffer.from(text)]));
    this._thread(nodeIdHex).push({ dir: "out", text, ts: Date.now() });
    if (this._isAiTrigger(text)) return this.askAI(nodeIdHex, this._stripTrigger(text));
    return null;
  }

  async askAI(nodeIdHex, query) {
    const thread = this._thread(nodeIdHex);
    const context = thread.slice(-AI_CONTEXT_MESSAGES);
    let reply;
    if (this.noAi) {
      reply = "[IA desactivee - mode --no-ai]";
    } else {
      try {
        const { queryGemini } = require("../ai/gemini");
        reply = await queryGemini(context, query);
      } catch (e) {
        reply = "[IA indisponible (" + (e.code || "ERR") + ") : " + e.message + "]";
      }
    }
    thread.push({ dir: "ai", text: reply, ts: Date.now() });
    this.emit("ai-reply", { peer: nodeIdHex, reply });
    return reply;
  }

  sendFile(nodeIdHex, filepath) {
    if (!fs.existsSync(filepath)) throw new Error("fichier introuvable: " + filepath);
    const manifest = buildManifest(filepath);
    this.fileNode.seed(manifest, filepath);
    return { file_id: manifest.file_id, filename: manifest.filename, size: manifest.size, nb_chunks: manifest.nb_chunks };
  }

  listAvailable() {
    return Object.values(this.availableFiles).map(({ manifest, from }) => ({
      file_id: manifest.file_id, filename: manifest.filename, size: manifest.size,
      nb_chunks: manifest.nb_chunks, from,
    }));
  }

  async download(fileId) {
    const entry = this.availableFiles[fileId];
    const manifest = (entry && entry.manifest) || this.fileNode.manifests[fileId];
    if (!manifest) throw new Error("manifest inconnu pour " + fileId.slice(0, 8));
    const out = path.join(this.downloadDir, manifest.filename);
    const res = await this.fileNode.download(manifest, out, { parallel: 16 });
    return { ...res, out, filename: manifest.filename };
  }

  trustPeer(nodeId) { this.trust.trust(nodeId); return this.trust.list(); }

  peersList() {
    const discovered = this.discovery ? this.discovery.getPeers() : [];
    const byId = new Map();
    for (const p of discovered) byId.set(p.nodeId, { nodeId: p.nodeId, address: p.address, securePort: p.securePort, connected: false });
    for (const id of this.sessionsByPeer.keys()) {
      const e = byId.get(id) || { nodeId: id, address: "session", securePort: null };
      e.connected = true; byId.set(id, e);
    }
    return [...byId.values()].map((e) => ({ ...e, trusted: this.trust.isTrusted(e.nodeId), self: e.nodeId === this.selfHex }));
  }

  status() {
    return {
      nodeId: this.selfHex,
      tcpPort: this.tcpPort, securePort: this.securePort,
      controlPort: this.controlPort, controlHost: this.controlHost,
      peersDiscovered: this.discovery ? this.discovery.getPeers().length : 0,
      sessions: this.sessionsByPeer.size,
      filesLocal: Object.keys(this.store.index.files).length,
      filesAvailable: Object.keys(this.availableFiles).length,
      trusted: this.trust.list().length,
      aiEnabled: !this.noAi,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  getThread(nodeIdHex) { return this._thread(nodeIdHex); }

  stop() {
    try { this.secureServer && this.secureServer.close(); } catch {}
    try { this.control && this.control.close(); } catch {}
    try { this.discovery && this.discovery.stop(); } catch {}
    try { this.peers && this.peers.stop(); } catch {}
  }
}

module.exports = { AttestP2PNode, CHAT };
