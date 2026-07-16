// Web of Trust minimal : ensemble des node_id explicitement approuvés par
// l'utilisateur, persisté dans .attestp2p/trust.json.

const fs = require("fs");
const path = require("path");

class TrustStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.set = new Set(this._load());
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")).trusted || []; } catch { return []; } }
  _save() { fs.writeFileSync(this.file, JSON.stringify({ trusted: [...this.set] }, null, 2)); }
  trust(nodeId) { this.set.add(nodeId); this._save(); }
  untrust(nodeId) { this.set.delete(nodeId); this._save(); }
  isTrusted(nodeId) { return this.set.has(nodeId); }
  list() { return [...this.set]; }
}

module.exports = { TrustStore };
