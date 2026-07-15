const net = require("net");
const { extractPackets, verifyPacket, parsePacket, verifySignature } = require("../protocol/packet");
const { unwrapPayload } = require("../protocol/message");
const { ReplayGuard } = require("../protocol/replay");
const { IpRateLimiter } = require("./ipRateLimiter");
const { IpBlacklist } = require("./ipBlacklist");
const { logAttack } = require("../security/attackLog");
const {
  MAX_BUFFER_SIZE,
  MAX_PACKETS_PER_SECOND,
  SOCKET_IDLE_TIMEOUT,
  PARTIAL_PACKET_TIMEOUT,
  MAX_CONNECTION_TIME
} = require("../config");


function startTCPServer(port, options = {}) {

  // 🛡 État de sécurité PARTAGÉ entre toutes les sockets :
  //  - replayGuard : un nonce vu sur une connexion est rejeté sur les autres
  //  - ipRateLimiter : quota cumulé par IP (toutes connexions)
  //  - blacklist : bannissement temporaire d'une IP après trop d'infractions
  const replayGuard = options.replayGuard || new ReplayGuard();
  const ipRateLimiter = options.ipRateLimiter || new IpRateLimiter();
  const blacklist = options.blacklist || new IpBlacklist();

  const cleanupTimer = setInterval(() => {
    ipRateLimiter.cleanup();
    blacklist.cleanup();
  }, 5000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  const server = net.createServer((socket) => {

    const remoteIp = socket.remoteAddress;

    // 🚫 IP déjà bannie : on refuse immédiatement, sans traiter le moindre octet.
    if (blacklist.isBanned(remoteIp)) {
      logAttack("banned_reconnect", remoteIp);
      socket.destroy();
      return;
    }

    console.log("📡 Client connecté:", remoteIp);

    let buffer = Buffer.alloc(0);
    let lastActivity = Date.now();
    let connectionStart = Date.now();

    // 🛡 Rate limit PAR socket
    let packetCount = 0;
    let rateWindowStart = Date.now();

    // Enregistre une infraction : log + strike (peut bannir) + fermeture socket.
    function flagAttack(type, meta = {}) {
      const res = blacklist.strike(remoteIp);
      logAttack(type, remoteIp, { ...meta, strikes: res.count, banned: res.banned });
      if (res.banned) {
        console.log("🚫 IP bannie temporairement:", remoteIp);
      }
      socket.destroy();
    }

    socket.setTimeout(SOCKET_IDLE_TIMEOUT);

    socket.on("timeout", () => {
      console.log("⚠️ Connexion inactive - fermeture");
      socket.destroy();
    });

    socket.on("data", (data) => {

      lastActivity = Date.now();
      buffer = Buffer.concat([buffer, data]);

      // 🛡 Protection saturation mémoire : buffer cumulatif borné
      if (buffer.length > MAX_BUFFER_SIZE) {
        flagAttack("buffer_overflow", { bufferLen: buffer.length });
        return;
      }

      try {

        const result = extractPackets(buffer);

        for (const packet of result.packets) {

          const now = Date.now();

          // 🛡 Rate limit par socket, réinitialisé chaque seconde
          if (now - rateWindowStart > 1000) {
            packetCount = 0;
            rateWindowStart = now;
          }
          packetCount++;
          if (packetCount > MAX_PACKETS_PER_SECOND) {
            flagAttack("rate_limit_socket", { packetCount });
            return;
          }

          // 🛡 Rate limit cumulé PAR IP
          if (!ipRateLimiter.allow(remoteIp, now)) {
            flagAttack("rate_limit_ip");
            return;
          }

          // 🔒 HMAC : intégrité + clé partagée
          if (!verifyPacket(packet)) {
            flagAttack("hmac_invalid");
            return;
          }

          // 🔐 Signature Ed25519 : authenticité de l'émetteur
          const parsed = parsePacket(packet);
          if (!verifySignature(parsed)) {
            flagAttack("signature_invalid");
            return;
          }

          // ⏱ Anti-replay : enveloppe timestamp + nonce en tête de payload
          const { timestamp, nonce, data: appData } = unwrapPayload(parsed.payload);
          const replay = replayGuard.check(parsed.nodeId, timestamp, nonce, now);
          if (!replay.ok) {
            flagAttack("replay", { reason: replay.reason });
            return;
          }

          console.log(
            "✔ Packet valide reçu (type=" + parsed.type +
            ", data=" + appData.length + " octets)"
          );

        }

        buffer = result.remaining;

      } catch (err) {

        // Flux malformé (MAGIC invalide, tailles incohérentes, enveloppe absente…)
        flagAttack("malformed_packet", { error: err.message });

      }

    });

    // 🛡 Protection packet incomplet (Slowloris)
    const partialCheck = setInterval(() => {

      const now = Date.now();

      if (buffer.length > 0 && now - lastActivity > PARTIAL_PACKET_TIMEOUT) {
        flagAttack("slowloris");
      }

      if (now - connectionStart > MAX_CONNECTION_TIME) {
        console.log("⚠️ Connexion trop longue");
        socket.destroy();
      }

    }, 1000);

    socket.on("close", () => {
      clearInterval(partialCheck);
      console.log("🔌 Client déconnecté");
    });

    socket.on("error", (err) => {
      clearInterval(partialCheck);
      console.log("⚠️ Erreur socket:", err.message);
    });

  });

  server.on("close", () => clearInterval(cleanupTimer));

  server.listen(port, () => {
    console.log("🚀 TCP Server sécurisé sur port", port);
  });

  return server;
}

module.exports = { startTCPServer };
