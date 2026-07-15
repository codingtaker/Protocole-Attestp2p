// Serveur TCP de sessions chiffrées (Sprint 3), durci avec les défenses réseau :
//   - Blacklist IP : une IP bannie est refusée dès la connexion.
//   - Rate limit par IP : borne le nombre de frames par IP (toutes connexions).
//   - Attack log + strikes : chaque infraction (handshake/déchiffrement invalide,
//     frame trop grande, rate limit) est journalisée et rapproche l'IP du ban.
//
// Les instances de défense sont partagées entre toutes les connexions et
// injectables (tests / configuration).

const net = require("net");
const { SecureConnection } = require("../session/secureConnection");
const { IpBlacklist } = require("./ipBlacklist");
const { IpRateLimiter } = require("./ipRateLimiter");
const { logAttack } = require("../security/attackLog");

function startSecureServer(port, onConnection, options = {}) {
  const blacklist = options.blacklist || new IpBlacklist();
  const ipRateLimiter = options.ipRateLimiter || new IpRateLimiter();

  const cleanupTimer = setInterval(() => {
    ipRateLimiter.cleanup();
    blacklist.cleanup();
  }, 5000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  // Contexte de sécurité partagé, consommé par chaque SecureConnection.
  const security = {
    allowFrame(ip) {
      return !blacklist.isBanned(ip) && ipRateLimiter.allow(ip);
    },
    report(type, ip, meta) {
      const res = blacklist.strike(ip);
      logAttack(type, ip, { ...meta, strikes: res.count, banned: res.banned });
      if (res.banned) console.log("🚫 IP bannie temporairement:", ip);
    },
  };

  const server = net.createServer((socket) => {
    const ip = socket.remoteAddress;

    // 🚫 IP déjà bannie : refus immédiat.
    if (blacklist.isBanned(ip)) {
      logAttack("banned_reconnect", ip);
      socket.destroy();
      return;
    }

    const conn = new SecureConnection(socket, { initiator: false, security });
    conn.on("error", (err) => {
      console.log("⚠️ Session refusée (" + ip + "):", err.message);
    });
    if (typeof onConnection === "function") onConnection(conn);
  });

  server.on("close", () => clearInterval(cleanupTimer));

  server.listen(port, () => {
    console.log("🔐 Secure server sur port", server.address().port);
  });

  // Expose les défenses (utile pour supervision / tests).
  server.blacklist = blacklist;
  server.ipRateLimiter = ipRateLimiter;
  return server;
}

module.exports = { startSecureServer };
