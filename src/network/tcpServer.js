const net = require("net");
const { extractPackets, verifyPacket, parsePacket, verifySignature } = require("../protocol/packet");
const { unwrapPayload } = require("../protocol/message");
const { ReplayGuard } = require("../protocol/replay");
const { IpRateLimiter } = require("./ipRateLimiter");
const {
  MAX_BUFFER_SIZE,
  MAX_PACKETS_PER_SECOND,
  SOCKET_IDLE_TIMEOUT,
  PARTIAL_PACKET_TIMEOUT,
  MAX_CONNECTION_TIME
} = require("../config");


function startTCPServer(port, options = {}) {

  // 🛡 Garde anti-replay et rate limit par IP PARTAGÉS entre toutes les sockets :
  // un nonce vu sur une connexion est rejeté sur les autres, et le quota par IP
  // couvre l'ensemble des connexions d'une même source.
  const replayGuard = options.replayGuard || new ReplayGuard();
  const ipRateLimiter = options.ipRateLimiter || new IpRateLimiter();

  // Nettoyage périodique des compteurs IP inactifs.
  const cleanupTimer = setInterval(() => ipRateLimiter.cleanup(), 5000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  const server = net.createServer((socket) => {

    const remoteIp = socket.remoteAddress;
    console.log("📡 Client connecté:", remoteIp);

    let buffer = Buffer.alloc(0);
    let lastActivity = Date.now();
    let connectionStart = Date.now();

    // 🛡 Rate limit PAR socket (évite qu'un attaquant bloque les autres pairs)
    let packetCount = 0;
    let rateWindowStart = Date.now();

    // 🔥 timeout automatique Node
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
        console.log("🚨 Buffer cumulatif trop grand - fermeture");
        socket.destroy();
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
            console.log("🚨 Rate limit socket dépassé - fermeture");
            socket.destroy();
            return;
          }

          // 🛡 Rate limit cumulé PAR IP (toutes connexions de cette source)
          if (!ipRateLimiter.allow(remoteIp, now)) {
            console.log("🚨 Rate limit IP dépassé - fermeture:", remoteIp);
            socket.destroy();
            return;
          }

          // 🔒 HMAC : intégrité + clé partagée
          if (!verifyPacket(packet)) {
            console.log("❌ HMAC invalide - fermeture");
            socket.destroy();
            return;
          }

          // 🔐 Signature Ed25519 : authenticité de l'émetteur
          const parsed = parsePacket(packet);
          if (!verifySignature(parsed)) {
            console.log("❌ Signature Ed25519 invalide - fermeture");
            socket.destroy();
            return;
          }

          // ⏱ Anti-replay : enveloppe timestamp + nonce en tête de payload
          const { timestamp, nonce, data } = unwrapPayload(parsed.payload);
          const replay = replayGuard.check(parsed.nodeId, timestamp, nonce, now);
          if (!replay.ok) {
            console.log("♻️ Paquet rejeté (" + replay.reason + ") - fermeture");
            socket.destroy();
            return;
          }

          console.log(
            "✔ Packet valide reçu (type=" + parsed.type +
            ", data=" + data.length + " octets)"
          );

        }

        buffer = result.remaining;

      } catch (err) {

        console.log("🚨 Packet malformé:", err.message);
        socket.destroy();

      }

    });

    // 🛡 Protection packet incomplet (Slowloris)
    const partialCheck = setInterval(() => {

      const now = Date.now();

      if (buffer.length > 0 && now - lastActivity > PARTIAL_PACKET_TIMEOUT) {
        console.log("🚨 Packet incomplet trop long (Slowloris)");
        socket.destroy();
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
