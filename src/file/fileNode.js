// Module 3.2 — Orchestrateur de transfert (façon BitTorrent) au-dessus des
// sessions chiffrées. Un FileNode :
//   - sert les chunks qu'il possède (seeding / partage automatique),
//   - télécharge un fichier en multi-source avec stratégie Rarest First,
//     pipeline parallèle, vérification SHA-256 par chunk, re-demande sur
//     corruption, et fallback si un pair se déconnecte.

const EventEmitter = require("events");
const fs = require("fs");
const sodium = require("libsodium-wrappers");
const { sign } = require("../crypto/keys");
const { ChunkStore, sha256 } = require("./chunkStore");
const { verifyManifest } = require("./manifest");
const P = require("./protocol");

function chunkSigMessage(fileIdHex, idx, chunkHashBuf) {
  const b = Buffer.alloc(4); b.writeUInt32BE(idx, 0);
  return Buffer.concat([Buffer.from(fileIdHex, "hex"), b, chunkHashBuf]);
}

class FileNode extends EventEmitter {
  constructor({ store, parallel = 8, requestTimeoutMs = 15000 } = {}) {
    super();
    this.store = store;
    this.parallel = parallel;
    this.requestTimeoutMs = requestTimeoutMs;
    this.sessions = new Map();   // peerHex -> session
    this.manifests = {};         // fileId -> manifest
    this.downloads = {};         // fileId -> download state
    this.peerHave = new Map();   // peerHex -> Map(fileId -> Set(idx))  (availabilité)
  }

  _safeSend(session, buf) { try { session.send(buf); } catch { /* session fermée */ } }

  attachSession(session) {
    // Clé de session unique (permet plusieurs pairs, y compris de meme identite en test).
    const peerHex = session.peerId.toString("hex") + "#" + (this._seq = (this._seq || 0) + 1);
    this.sessions.set(peerHex, session);
    this.peerHave.set(peerHex, this.peerHave.get(peerHex) || new Map());
    session._peerHex = peerHex;
    session.on("message", (buf) => { try { this._onMessage(session, buf); } catch (e) { this.emit("error", e); } });
    session.on("close", () => this._onClose(peerHex));
    // Annonce nos manifests + bitfields connus au nouveau pair.
    for (const fileId of Object.keys(this.store.index.files)) {
      if (this.manifests[fileId]) this._safeSend(session, P.encManifest(this.manifests[fileId]));
      this._safeSend(session, P.encHave(fileId, this.store.bitfield(fileId)));
    }
    return peerHex;
  }

  registerManifest(manifest) {
    this.manifests[manifest.file_id] = manifest;
    this.store.registerManifest(manifest);
  }

  // Rôle seeder : charge tout le fichier dans le store puis l'annonce.
  seed(manifest, filePath) {
    this.registerManifest(manifest);
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(manifest.chunk_size);
      for (let i = 0; i < manifest.nb_chunks; i++) {
        const size = manifest.chunks[i].size;
        fs.readSync(fd, buf, 0, size, i * manifest.chunk_size);
        this.store.putChunk(manifest.file_id, i, buf.subarray(0, size), manifest.chunks[i].hash);
      }
    } finally { fs.closeSync(fd); }
    for (const s of this.sessions.values()) {
      this._safeSend(s, P.encManifest(manifest));
      this._safeSend(s, P.encHave(manifest.file_id, this.store.bitfield(manifest.file_id)));
    }
  }

  _onMessage(session, buf) {
    const m = P.decode(buf);
    switch (m.type) {
      case P.T.MANIFEST:
        if (verifyManifest(m.manifest)) { this.registerManifest(m.manifest); this.emit("manifest", m.manifest); }
        break;
      case P.T.HAVE: {
        const nb = this.manifests[m.fileId] ? this.manifests[m.fileId].nb_chunks
                 : (this.store.index.files[m.fileId] || {}).nb_chunks;
        if (nb != null) {
          const set = this._peerFileSet(session._peerHex, m.fileId);
          for (const i of ChunkStore.parseBitfield(m.bitfield, nb)) set.add(i);
          this._schedule(m.fileId);
        }
        break;
      }
      case P.T.HAVE_PIECE:
        this._peerFileSet(session._peerHex, m.fileId).add(m.idx);
        this._schedule(m.fileId);
        break;
      case P.T.CHUNK_REQ:
        this._serveChunk(session, m.fileId, m.idx);
        break;
      case P.T.CHUNK_DATA:
        this._onChunkData(session, m);
        break;
      case P.T.ACK:
        break; // fournisseur informé du statut
    }
  }

  _peerFileSet(peerHex, fileId) {
    let byFile = this.peerHave.get(peerHex);
    if (!byFile) { byFile = new Map(); this.peerHave.set(peerHex, byFile); }
    let set = byFile.get(fileId);
    if (!set) { set = new Set(); byFile.set(fileId, set); }
    return set;
  }

  // --- Service (fournisseur) ---
  _serveChunk(session, fileId, idx) {
    if (!this.store.hasChunk(fileId, idx)) { this._safeSend(session, P.encAck(idx, P.ACK_NOT_FOUND)); return; }
    const data = this.store.getChunk(fileId, idx);
    const chunkHash = sha256(data);
    const sig = sign(chunkSigMessage(fileId, idx, chunkHash)); // signature Ed25519 du fournisseur
    this._safeSend(session, P.encChunkData(fileId, idx, chunkHash, sig, data));
  }

  // --- Téléchargement ---
  download(manifest, outPath, opts = {}) {
    this.registerManifest(manifest);
    const fileId = manifest.file_id;
    return new Promise((resolve, reject) => {
      const needed = new Set();
      for (let i = 0; i < manifest.nb_chunks; i++) if (!this.store.hasChunk(fileId, i)) needed.add(i);
      const d = {
        manifest, fileId, outPath, needed,
        inFlight: new Map(),        // idx -> { peerHex, timer }
        badPeerForChunk: new Map(), // idx -> Set(peerHex) fournisseurs corrompus
        parallel: opts.parallel || this.parallel,
        resolve, reject, done: false,
        received: manifest.nb_chunks - needed.size,
      };
      this.downloads[fileId] = d;
      // (Re)demande les bitfields aux pairs connectés.
      for (const s of this.sessions.values()) this._safeSend(s, P.encHave(fileId, this.store.bitfield(fileId)));
      if (needed.size === 0) return this._complete(fileId);
      d.tick = setInterval(() => this._schedule(fileId), 400); // filet anti-blocage
      if (d.tick.unref) d.tick.unref();
      this._schedule(fileId);
    });
  }

  _availabilityCount(d) {
    const count = new Map();
    for (const byFile of this.peerHave.values()) {
      const set = byFile.get(d.fileId);
      if (!set) continue;
      for (const idx of set) if (d.needed.has(idx) && !d.inFlight.has(idx)) count.set(idx, (count.get(idx) || 0) + 1);
    }
    return count;
  }

  _peersForChunk(d, idx) {
    const bad = d.badPeerForChunk.get(idx);
    const peers = [];
    for (const [peerHex, byFile] of this.peerHave) {
      const set = byFile.get(d.fileId);
      if (!set || !set.has(idx)) continue;
      if (bad && bad.has(peerHex)) continue;
      if (!this.sessions.has(peerHex)) continue;
      peers.push(peerHex);
    }
    return peers;
  }

  _inFlightForPeer(d, peerHex) {
    let n = 0; for (const v of d.inFlight.values()) if (v.peerHex === peerHex) n++; return n;
  }

  _schedule(fileId) {
    const d = this.downloads[fileId];
    if (!d || d.done) return;
    // Rarest First : chunks triés par availabilité croissante.
    const count = this._availabilityCount(d);
    const candidates = [...count.keys()].sort((a, b) => (count.get(a) - count.get(b)) || (Math.random() - 0.5));
    for (const idx of candidates) {
      if (d.inFlight.size >= d.parallel) break;
      if (d.inFlight.has(idx)) continue;
      const peers = this._peersForChunk(d, idx);
      if (peers.length === 0) continue;
      peers.sort((a, b) => this._inFlightForPeer(d, a) - this._inFlightForPeer(d, b)); // équilibrage
      const peerHex = peers[0];
      const session = this.sessions.get(peerHex);
      const timer = setTimeout(() => this._onTimeout(fileId, idx), this.requestTimeoutMs);
      if (timer.unref) timer.unref();
      d.inFlight.set(idx, { peerHex, timer });
      this._safeSend(session, P.encChunkReq(fileId, idx));
    }
  }

  _onTimeout(fileId, idx) {
    const d = this.downloads[fileId];
    if (!d) return;
    const inf = d.inFlight.get(idx);
    if (!inf) return;
    clearTimeout(inf.timer);
    d.inFlight.delete(idx);
    this._schedule(fileId); // réessaie ailleurs
  }

  _onChunkData(session, m) {
    const d = this.downloads[m.fileId];
    if (!d) return;
    const idx = m.idx;
    const inf = d.inFlight.get(idx);
    const expected = d.manifest.chunks[idx] && d.manifest.chunks[idx].hash;

    // Vérification : signature fournisseur + SHA-256 des données == hash manifest.
    let okSig = false;
    try { okSig = sodium.crypto_sign_verify_detached(m.signature, chunkSigMessage(m.fileId, idx, m.chunkHash), session.peerId); } catch { okSig = false; }
    const dataHash = sha256(m.data).toString("hex");
    const good = okSig && expected && dataHash === expected && m.chunkHash.toString("hex") === expected;

    if (inf) { clearTimeout(inf.timer); d.inFlight.delete(idx); }

    if (!good) {
      this._safeSend(session, P.encAck(idx, P.ACK_HASH_MISMATCH));
      if (!d.badPeerForChunk.has(idx)) d.badPeerForChunk.set(idx, new Set());
      d.badPeerForChunk.get(idx).add(session._peerHex); // re-demande ailleurs
      this.emit("corrupt", { fileId: m.fileId, idx, from: session._peerHex });
      this._schedule(m.fileId);
      return;
    }

    const res = this.store.putChunk(m.fileId, idx, m.data, expected);
    if (!res.ok) { this._schedule(m.fileId); return; }
    d.needed.delete(idx);
    d.received++;
    this._safeSend(session, P.encAck(idx, P.ACK_OK));
    // Partage : annonce ce chunk aux autres pairs (multi-source).
    for (const s of this.sessions.values()) this._safeSend(s, P.encHavePiece(m.fileId, idx));
    this.emit("progress", { fileId: m.fileId, idx, received: d.received, total: d.manifest.nb_chunks });
    if (d.needed.size === 0) this._complete(m.fileId);
    else this._schedule(m.fileId);
  }

  _onClose(peerHex) {
    this.sessions.delete(peerHex);
    this.peerHave.delete(peerHex);
    for (const d of Object.values(this.downloads)) {
      for (const [idx, inf] of [...d.inFlight]) {
        if (inf.peerHex === peerHex) { clearTimeout(inf.timer); d.inFlight.delete(idx); } // fallback
      }
      this._schedule(d.fileId);
    }
    this.emit("peerclose", peerHex);
  }

  _complete(fileId) {
    const d = this.downloads[fileId];
    if (!d || d.done) return;
    d.done = true;
    if (d.tick) clearInterval(d.tick);
    for (const inf of d.inFlight.values()) clearTimeout(inf.timer);
    try {
      const sha = this.store.assemble(fileId, d.outPath);
      d.resolve({ sha256: sha, matches: sha === d.manifest.file_id, outPath: d.outPath });
    } catch (e) { d.reject(e); }
    delete this.downloads[fileId];
  }
}

module.exports = { FileNode };
