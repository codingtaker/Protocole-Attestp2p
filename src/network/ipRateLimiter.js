// Rate limit cumulé PAR adresse IP, en complément du rate limit par socket.
// Un attaquant qui ouvre N connexions depuis la même IP est ainsi borné
// globalement, et pas seulement connexion par connexion.

const { MAX_PACKETS_PER_SECOND_PER_IP } = require("../config");

class IpRateLimiter {
  constructor(limit = MAX_PACKETS_PER_SECOND_PER_IP, windowMs = 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.counters = new Map(); // ip -> { count, windowStart }
  }

  // Incrémente le compteur de l'IP pour la fenêtre courante.
  // Retourne true si autorisé, false si la limite est dépassée.
  allow(ip, now = Date.now()) {
    let c = this.counters.get(ip);
    if (!c || now - c.windowStart > this.windowMs) {
      c = { count: 0, windowStart: now };
      this.counters.set(ip, c);
    }
    c.count++;
    return c.count <= this.limit;
  }

  // Évince les IP inactives (fenêtre largement expirée) pour borner la mémoire.
  cleanup(now = Date.now()) {
    for (const [ip, c] of this.counters) {
      if (now - c.windowStart > this.windowMs * 2) {
        this.counters.delete(ip);
      }
    }
  }

  size() {
    return this.counters.size;
  }
}

module.exports = { IpRateLimiter };
