
require('dotenv').config();

const path = require("path");

// Lecture dynamique de la clé HMAC : on refuse de démarrer avec une clé absente
// plutôt que de retomber silencieusement sur un secret en dur.
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
  NODE_NAME: process.env.NODE_NAME || "attestp2p-node",
  MULTICAST_ADDR: process.env.MULTICAST_ADDR || "239.255.42.99",
  MULTICAST_PORT: Number(process.env.MULTICAST_PORT) || 6000,
  MAGIC: Buffer.from("ARCH"), // 4 bytes
  getHmacKey,

  // 🔑 Persistance de l'identité (seed Ed25519). Fichier ignoré par git (*.key).
  IDENTITY_FILE: process.env.IDENTITY_FILE || path.join(process.cwd(), "identity.key"),

  // Sécurité DoS
  MAX_PAYLOAD_SIZE: 1 * 1024 * 1024,   // 1MB max par message
  MAX_PACKET_SIZE: 2 * 1024 * 1024,    // 2MB max total packet
  MAX_BUFFER_SIZE: 5 * 1024 * 1024,    // 5MB max buffer cumulatif
  MAX_PACKETS_PER_SECOND: 50,          // Limite de 50 packets/s PAR socket
  MAX_PACKETS_PER_SECOND_PER_IP: 200,  // Limite cumulée PAR adresse IP (toutes connexions)

  // 🛡 Protection Slowloris
  SOCKET_IDLE_TIMEOUT: 10000,      // 10 sec sans activité
  PARTIAL_PACKET_TIMEOUT: 5000,    // packet incomplet
  MAX_CONNECTION_TIME: 60000,      // 1 min max

  // ⏱ Anti-replay : enveloppe timestamp(8) + nonce(16) en tête de payload
  REPLAY_ENVELOPE_LEN: 24,         // 8 (timestamp ms, UInt64BE) + 16 (nonce)
  REPLAY_WINDOW_MS: 30000,         // fenêtre d'acceptation d'un timestamp (±30s)
  REPLAY_CACHE_MAX: 100000,        // borne mémoire du cache de nonces vus

  // 📡 UDP discovery
  DISCOVERY_INTERVAL_MS: 5000,     // fréquence d'annonce multicast
  PEER_TTL_MS: 15000               // durée de vie d'un pair sans nouvelle annonce
};
