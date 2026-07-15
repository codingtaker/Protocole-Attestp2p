// PeerManager : ouvre des sessions chiffrées vers les pairs annoncés par la
// discovery. Déduplique par nodeId (une session par pair), ignore soi-même, et
// nettoie les sessions fermées. La source de pairs (`discovery`) et la fonction
// de connexion (`connect`) sont injectables (tests / configuration).

const { connectSecure } = require("../network/secureClient");
const { PEER_DIAL_INTERVAL_MS } = require("../config");

class PeerManager {
  constructor({ selfId, discovery, connect, onSession, intervalMs } = {}) {
    if (!selfId) throw new Error("PeerManager : selfId requis");
    if (!discovery || typeof discovery.getPeers !== "function") {
      throw new Error("PeerManager : discovery.getPeers requis");
    }
    this.selfId = Buffer.isBuffer(selfId) ? selfId.toString("hex") : String(selfId);
    this.discovery = discovery;
    this.connect = connect || connectSecure;
    this.onSession = onSession || null;
    this.intervalMs = intervalMs || PEER_DIAL_INTERVAL_MS;
    this.sessions = new Map(); // nodeId -> SecureConnection
    this.dialing = new Set();  // nodeId en cours de composition
  }

  start() {
    this._timer = setInterval(() => this.tick(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    this.tick();
    return this;
  }

  tick() {
    for (const peer of this.discovery.getPeers()) {
      if (!peer.securePort) continue;                 // pair sans session chiffrée
      if (peer.nodeId === this.selfId) continue;       // pas de self-dial
      if (this.sessions.has(peer.nodeId)) continue;    // déjà connecté
      if (this.dialing.has(peer.nodeId)) continue;     // composition en cours
      this._dial(peer);
    }
  }

  _dial(peer) {
    this.dialing.add(peer.nodeId);
    const conn = this.connect(peer.securePort, peer.address, () => {
      this.dialing.delete(peer.nodeId);
      this.sessions.set(peer.nodeId, conn);
      if (this.onSession) this.onSession(conn, peer);
    });
    conn.on("error", () => this.dialing.delete(peer.nodeId));
    conn.on("close", () => {
      this.dialing.delete(peer.nodeId);
      this.sessions.delete(peer.nodeId);
    });
  }

  activeCount() {
    return this.sessions.size;
  }

  stop() {
    clearInterval(this._timer);
    for (const conn of this.sessions.values()) {
      try { conn.close(); } catch { /* best-effort */ }
    }
    this.sessions.clear();
  }
}

module.exports = { PeerManager };
