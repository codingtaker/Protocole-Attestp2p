// Protection anti-replay : rejette un paquet dont le timestamp est hors fenêtre
// ou dont le couple (nodeId, nonce) a déjà été vu. Combine une borne temporelle
// (fraîcheur) et un cache de nonces (unicité), avec une borne mémoire dure.

const { REPLAY_WINDOW_MS, REPLAY_CACHE_MAX } = require("../config");

class ReplayGuard {
  constructor({ windowMs = REPLAY_WINDOW_MS, maxEntries = REPLAY_CACHE_MAX } = {}) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    // Map insertion-ordonnée : clé "nodeIdHex:nonceHex" -> timestamp (ms).
    this.seen = new Map();
  }

  _key(nodeId, nonce) {
    return nodeId.toString("hex") + ":" + nonce.toString("hex");
  }

  // Purge paresseuse des entrées expirées (au-delà de la fenêtre).
  _purge(now) {
    for (const [key, ts] of this.seen) {
      if (now - ts > this.windowMs) {
        this.seen.delete(key);
      } else {
        // Insertion ~ chronologique : dès qu'une entrée est encore valide, le
        // reste l'est aussi. On peut s'arrêter.
        break;
      }
    }
  }

  // Retourne { ok: boolean, reason?: string }.
  check(nodeId, timestamp, nonce, now = Date.now()) {
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > this.windowMs) {
      return { ok: false, reason: "timestamp hors fenêtre" };
    }

    this._purge(now);

    const key = this._key(nodeId, nonce);
    if (this.seen.has(key)) {
      return { ok: false, reason: "nonce déjà vu (replay)" };
    }

    // Borne mémoire dure : si saturé, on évince la plus ancienne entrée.
    if (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      this.seen.delete(oldest);
    }

    this.seen.set(key, timestamp);
    return { ok: true };
  }

  size() {
    return this.seen.size;
  }
}

module.exports = { ReplayGuard };
