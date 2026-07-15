// Enveloppe applicative anti-replay.
// Le format binaire du paquet (packet.js) reste inchangé : on préfixe simplement
// le payload applicatif d'un timestamp (8 octets, ms depuis epoch, UInt64BE) et
// d'un nonce aléatoire (16 octets). Signature Ed25519 et HMAC couvrent donc aussi
// ces champs — un attaquant ne peut ni forger ni recycler l'enveloppe.
//
//   | timestamp(8) | nonce(16) |            data(N)            |
//   ── REPLAY_ENVELOPE_LEN (24) ──   ── payload applicatif ──

const crypto = require("crypto");
const { REPLAY_ENVELOPE_LEN } = require("../config");

const NONCE_LEN = 16;
const TIMESTAMP_LEN = 8;

// Emballe un payload applicatif dans une enveloppe fraîche (timestamp + nonce).
function wrapPayload(data) {
  if (!Buffer.isBuffer(data)) {
    throw new Error("wrapPayload : data doit être un Buffer");
  }
  const ts = Buffer.alloc(TIMESTAMP_LEN);
  ts.writeBigUInt64BE(BigInt(Date.now()), 0);
  const nonce = crypto.randomBytes(NONCE_LEN);
  return Buffer.concat([ts, nonce, data]);
}

// Décompose un payload reçu. Lève si le payload est trop court pour l'enveloppe.
function unwrapPayload(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < REPLAY_ENVELOPE_LEN) {
    throw new Error("unwrapPayload : payload trop court pour l'enveloppe anti-replay");
  }
  const timestamp = Number(payload.readBigUInt64BE(0));
  const nonce = payload.subarray(TIMESTAMP_LEN, REPLAY_ENVELOPE_LEN);
  const data = payload.subarray(REPLAY_ENVELOPE_LEN);
  return { timestamp, nonce, data };
}

module.exports = {
  wrapPayload,
  unwrapPayload,
  NONCE_LEN,
  TIMESTAMP_LEN,
};
