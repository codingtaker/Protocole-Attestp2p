const crypto = require("crypto");
const { MAGIC, getHmacKey, MAX_PAYLOAD_SIZE, MAX_PACKET_SIZE } = require("../config");
const { getPublicKey, sign } = require("../crypto/keys");
const sodium = require("libsodium-wrappers");

// Constantes de layout binaire
const HEADER_LEN = 41;       // MAGIC(4) + type(1) + nodeId(32) + payloadLen(4)
const SIGNATURE_LEN = 64;    // Ed25519 signature (crypto_sign_detached)
const HMAC_LEN = 32;         // HMAC-SHA256
const MIN_PACKET_LEN = HEADER_LEN + SIGNATURE_LEN + HMAC_LEN;

// Vérifie la signature Ed25519. Reste synchrone pour être utilisable dans le
// pipeline data du serveur TCP. Garde-fou explicite : si libsodium n'a pas été
// initialisé (initKeys()/await sodium.ready), on lève une erreur lisible au lieu
// de laisser sodium planter avec un message obscur.
function verifySignature(packet) {
  if (typeof sodium.crypto_sign_verify_detached !== "function") {
    throw new Error(
      "libsodium non initialisé : appelez initKeys() (ou await sodium.ready) avant verifySignature()"
    );
  }

  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(packet.payloadLen, 0);

  const body = Buffer.concat([
    MAGIC,
    Buffer.from([packet.type]),
    packet.nodeId,
    payloadLenBuf,
    packet.payload
  ]);

  return sodium.crypto_sign_verify_detached(
    packet.signature,
    body,
    packet.nodeId
  );
}

function buildPacket(type, payloadBuffer) {
  if (!Buffer.isBuffer(payloadBuffer)) {
    throw new Error("Payload must be a Buffer");
  }
  if (payloadBuffer.length > MAX_PAYLOAD_SIZE) {
    throw new Error("Payload size exceeds limit");
  }

  const nodeId = getPublicKey();

  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(payloadBuffer.length, 0);

  const header = Buffer.concat([
    MAGIC,
    Buffer.from([type]),
    nodeId,
    payloadLen
  ]);

  const body = Buffer.concat([header, payloadBuffer]);

  // 🔐 Signature Ed25519 sur HEADER + PAYLOAD
  const signature = sign(body); // 64 bytes

  const signedBody = Buffer.concat([body, signature]);

  // 🔒 HMAC sur tout sauf HMAC lui-même — clé récupérée à l'appel (throw si absente)
  const hmac = crypto.createHmac("sha256", getHmacKey()).update(signedBody).digest();

  return Buffer.concat([signedBody, hmac]);
}

function parsePacket(buffer) {
  // 🛡 Préconditions : parsePacket peut être appelé isolément (hors extractPackets).
  // On refuse un buffer trop court ou un payloadLen incohérent plutôt que de
  // tronquer/décaler silencieusement signature et HMAC.
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_PACKET_LEN) {
    throw new Error("parsePacket : buffer trop court (< MIN_PACKET_LEN)");
  }

  const magic = buffer.subarray(0, 4).toString();
  const type = buffer.readUInt8(4);
  const nodeId = buffer.subarray(5, 37);
  const payloadLen = buffer.readUInt32BE(37);

  const totalLength = HEADER_LEN + payloadLen + SIGNATURE_LEN + HMAC_LEN;
  if (payloadLen > MAX_PAYLOAD_SIZE || totalLength > buffer.length) {
    throw new Error("parsePacket : payloadLen incohérent avec la taille du buffer");
  }

  const payloadStart = HEADER_LEN;
  const payloadEnd = payloadStart + payloadLen;

  const payload = buffer.subarray(payloadStart, payloadEnd);

  const signatureStart = payloadEnd;
  const signatureEnd = signatureStart + SIGNATURE_LEN;

  const signature = buffer.subarray(signatureStart, signatureEnd);

  // Note : le HMAC est vérifié par verifyPacket sur le buffer brut ; on ne le
  // renvoie plus ici (champ mort côté consommateur).
  return {
    magic,
    type,
    nodeId,
    payloadLen,
    payload,
    signature
  };
}

function verifyPacket(buffer) {
  // 🛡 Garde-fous : évite les crashs de timingSafeEqual sur buffer tronqué
  if (!Buffer.isBuffer(buffer) || buffer.length < MIN_PACKET_LEN) {
    return false;
  }
  if (buffer.subarray(0, 4).compare(MAGIC) !== 0) {
    return false;
  }

  const body = buffer.subarray(0, buffer.length - HMAC_LEN);
  const receivedHmac = buffer.subarray(buffer.length - HMAC_LEN);
  const computedHmac = crypto.createHmac("sha256", getHmacKey()).update(body).digest();

  return crypto.timingSafeEqual(receivedHmac, computedHmac);
}

function extractPackets(buffer) {
  const packets = [];
  let offset = 0;

  while (offset + HEADER_LEN <= buffer.length) {

    // 🚨 Resynchronisation impossible : si le MAGIC n'est pas là, on considère
    // le flux corrompu (l'appelant devra fermer la connexion).
    if (buffer.subarray(offset, offset + 4).compare(MAGIC) !== 0) {
      throw new Error("Invalid MAGIC bytes");
    }

    const payloadLen = buffer.readUInt32BE(offset + 37);

    // 🚨 Protection payload abusif
    if (payloadLen > MAX_PAYLOAD_SIZE) {
      throw new Error("Payload size exceeds limit");
    }

    const totalLength = HEADER_LEN + payloadLen + SIGNATURE_LEN + HMAC_LEN;

    // 🚨 Protection packet abusif
    if (totalLength > MAX_PACKET_SIZE) {
      throw new Error("Packet size exceeds limit");
    }

    if (offset + totalLength > buffer.length) {
      break;
    }

    packets.push(buffer.subarray(offset, offset + totalLength));
    offset += totalLength;
  }

  return {
    packets,
    remaining: buffer.subarray(offset)
  };
}

module.exports = {
  buildPacket,
  parsePacket,
  verifyPacket,
  verifySignature,
  extractPackets,
  // Constantes de layout exposées pour les tests / consommateurs
  HEADER_LEN,
  SIGNATURE_LEN,
  HMAC_LEN,
  MIN_PACKET_LEN,
};
