
require('dotenv').config();

const path = require("path");

function getHmacKey() {
  const key = process.env.HMAC_SECRET;
  if (!key) {
    throw new Error(
      "HMAC_SECRET manquant : définissez la variable d'environnement (voir .env.example)"
    );
  }
  return key;
}

module.exports = {
  TCP_PORT: Number(process.env.TCP_PORT) || 7777,
  SECURE_TCP_PORT: Number(process.env.SECURE_TCP_PORT) || 7778,
  NODE_NAME: process.env.NODE_NAME || "attestp2p-node",
  MULTICAST_ADDR: process.env.MULTICAST_ADDR || "239.255.42.99",
  MULTICAST_PORT: Number(process.env.MULTICAST_PORT) || 6000,
  MAGIC: Buffer.from("ARCH"), // 4 bytes
  getHmacKey,

  IDENTITY_FILE: process.env.IDENTITY_FILE || path.join(process.cwd(), "identity.key"),

  // Sécurité DoS
  MAX_PAYLOAD_SIZE: 1 * 1024 * 1024,
  MAX_PACKET_SIZE: 2 * 1024 * 1024,
  MAX_BUFFER_SIZE: 5 * 1024 * 1024,
  MAX_PACKETS_PER_SECOND: 50,
  MAX_PACKETS_PER_SECOND_PER_IP: 200,

  // Slowloris
  SOCKET_IDLE_TIMEOUT: 10000,
  PARTIAL_PACKET_TIMEOUT: 5000,
  MAX_CONNECTION_TIME: 60000,

  // Anti-replay (protocole de paquets)
  REPLAY_ENVELOPE_LEN: 24,
  REPLAY_WINDOW_MS: 30000,
  REPLAY_CACHE_MAX: 100000,

  // UDP discovery
  DISCOVERY_INTERVAL_MS: 5000,
  PEER_TTL_MS: 15000,
  PEER_DIAL_INTERVAL_MS: 3000,

  // Blacklist IP
  BLACKLIST_BAN_MS: 5 * 60 * 1000,
  BLACKLIST_STRIKE_THRESHOLD: 5,
  BLACKLIST_STRIKE_WINDOW_MS: 60 * 1000,

  // Journal des attaques
  ATTACK_LOG_FILE: process.env.ATTACK_LOG_FILE || path.join(process.cwd(), "logs", "attacks.log"),

  // Session chiffrée (Sprint 3)
  SESSION_MAX_FRAME: 2 * 1024 * 1024,
  SESSION_HANDSHAKE_TIMEOUT: 5000,

  // Défenses applicatives INTRA-session (Sprint 3+)
  SESSION_MAX_MSG_PER_SECOND: 100,        // borne de messages applicatifs / s / session

  // Rekey automatique (initiateur) : selon volume ou durée
  SESSION_REKEY_EVERY_MSGS: 1000,         // renouveler après N messages émis
  SESSION_REKEY_EVERY_BYTES: 8 * 1024 * 1024, // ou après N octets émis
  SESSION_REKEY_EVERY_MS: 5 * 60 * 1000   // ou après N ms
};
