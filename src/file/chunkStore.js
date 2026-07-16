// Module 3.4 — Stockage local et index des chunks.
// Chaque nœud conserve les chunks téléchargés sous .attestp2p/<file_id>/<idx>.chunk
// et maintient un index JSON (.attestp2p/index.json) des chunks disponibles.
// Vérification d'intégrité (SHA-256) à l'écriture, réassemblage + SHA-256 final.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha256(b) { return crypto.createHash("sha256").update(b).digest(); }

class ChunkStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.indexPath = path.join(baseDir, "index.json");
    fs.mkdirSync(baseDir, { recursive: true });
    this.index = this._load();
  }
  _load() {
    try { return JSON.parse(fs.readFileSync(this.indexPath, "utf8")); }
    catch { return { files: {} }; }
  }
  _save() { fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2)); }
  _dir(fileId) { return path.join(this.baseDir, fileId); }

  // Enregistre les métadonnées d'un fichier (depuis un manifest vérifié).
  registerManifest(m, opts = {}) {
    if (!this.index.files[m.file_id]) {
      this.index.files[m.file_id] = {
        filename: m.filename, size: m.size, chunk_size: m.chunk_size,
        nb_chunks: m.nb_chunks, chunks: [],
        replicationFactor: opts.replicationFactor || 1,
      };
    }
    fs.mkdirSync(this._dir(m.file_id), { recursive: true });
    this._save();
  }

  hasChunk(fileId, idx) {
    const f = this.index.files[fileId];
    return !!f && f.chunks.includes(idx);
  }
  getChunk(fileId, idx) {
    return fs.readFileSync(path.join(this._dir(fileId), idx + ".chunk"));
  }

  // Écrit un chunk après vérification de son SHA-256. Retourne {ok, reason?, hash}.
  putChunk(fileId, idx, data, expectedHashHex) {
    const h = sha256(data).toString("hex");
    if (expectedHashHex && h !== expectedHashHex) {
      return { ok: false, reason: "HASH_MISMATCH", got: h };
    }
    fs.writeFileSync(path.join(this._dir(fileId), idx + ".chunk"), data);
    const f = this.index.files[fileId];
    if (f && !f.chunks.includes(idx)) {
      f.chunks.push(idx); f.chunks.sort((a, b) => a - b); this._save();
    }
    return { ok: true, hash: h };
  }

  availableChunks(fileId) {
    const f = this.index.files[fileId];
    return f ? f.chunks.slice() : [];
  }
  isComplete(fileId) {
    const f = this.index.files[fileId];
    return !!f && f.chunks.length === f.nb_chunks;
  }

  // Bitfield d'availabilité (1 bit par chunk, MSB first).
  bitfield(fileId) {
    const f = this.index.files[fileId];
    if (!f) return Buffer.alloc(0);
    const bf = Buffer.alloc(Math.ceil(f.nb_chunks / 8));
    for (const i of f.chunks) bf[i >> 3] |= (1 << (7 - (i & 7)));
    return bf;
  }
  static parseBitfield(bf, nbChunks) {
    const out = [];
    for (let i = 0; i < nbChunks; i++) {
      if (bf[i >> 3] & (1 << (7 - (i & 7)))) out.push(i);
    }
    return out;
  }

  // Réassemble le fichier dans outPath et retourne son SHA-256 (hex).
  assemble(fileId, outPath) {
    const f = this.index.files[fileId];
    if (!f || f.chunks.length !== f.nb_chunks) throw new Error("fichier incomplet");
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(outPath, "w");
    try {
      for (let i = 0; i < f.nb_chunks; i++) {
        const d = this.getChunk(fileId, i);
        fs.writeSync(fd, d, 0, d.length);
        hash.update(d);
      }
    } finally { fs.closeSync(fd); }
    return hash.digest("hex");
  }
}

module.exports = { ChunkStore, sha256 };
