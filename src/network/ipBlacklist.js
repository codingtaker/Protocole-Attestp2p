// Blacklist IP temporaire. Chaque infraction ("strike") est comptée dans une
// fenêtre glissante ; au-delà d'un seuil, l'IP est bannie pour une durée bornée
// puis automatiquement réhabilitée à l'expiration.

const {
  BLACKLIST_BAN_MS,
  BLACKLIST_STRIKE_THRESHOLD,
  BLACKLIST_STRIKE_WINDOW_MS,
} = require("../config");

class IpBlacklist {
  constructor({ banMs, strikeThreshold, strikeWindowMs } = {}) {
    this.banMs = banMs || BLACKLIST_BAN_MS;
    this.strikeThreshold = strikeThreshold || BLACKLIST_STRIKE_THRESHOLD;
    this.strikeWindowMs = strikeWindowMs || BLACKLIST_STRIKE_WINDOW_MS;
    this.strikes = new Map();  // ip -> { count, windowStart }
    this.bans = new Map();     // ip -> bannedUntil (timestamp ms)
  }

  // Vrai si l'IP est bannie à l'instant `now` (réhabilite paresseusement).
  isBanned(ip, now = Date.now()) {
    const until = this.bans.get(ip);
    if (until === undefined) return false;
    if (now >= until) {
      this.bans.delete(ip);
      return false;
    }
    return true;
  }

  // Bannit explicitement une IP pour `banMs`.
  ban(ip, now = Date.now()) {
    this.bans.set(ip, now + this.banMs);
    this.strikes.delete(ip);
    return now + this.banMs;
  }

  // Enregistre une infraction. Retourne { banned, count } ; bannit au seuil.
  strike(ip, now = Date.now()) {
    if (this.isBanned(ip, now)) return { banned: true, count: this.strikeThreshold };

    let s = this.strikes.get(ip);
    if (!s || now - s.windowStart > this.strikeWindowMs) {
      s = { count: 0, windowStart: now };
      this.strikes.set(ip, s);
    }
    s.count++;

    if (s.count >= this.strikeThreshold) {
      this.ban(ip, now);
      return { banned: true, count: s.count };
    }
    return { banned: false, count: s.count };
  }

  // Purge les entrées expirées (bans et fenêtres de strikes).
  cleanup(now = Date.now()) {
    for (const [ip, until] of this.bans) {
      if (now >= until) this.bans.delete(ip);
    }
    for (const [ip, s] of this.strikes) {
      if (now - s.windowStart > this.strikeWindowMs) this.strikes.delete(ip);
    }
  }

  bannedCount() {
    return this.bans.size;
  }
}

module.exports = { IpBlacklist };
