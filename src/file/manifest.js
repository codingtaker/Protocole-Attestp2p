// Module 3.1 — Manifest de fichier.
// Le manifest décrit un fichier découpé en chunks : identifiant global (SHA-256
// du fichier entier), taille, liste des chunks avec leur SHA-256, identité de
// l'émetteur et signature Ed25519 sur le hash du manifest.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers");
const { sign, getPublicKey } = require("../crypto/keys");

const DEFAULT_CHUNK_SIZE = 512 * 1024; // 512 KB

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

// Hash déterministe du manifest, SANS le champ signature (ordre de clés fixe).
function manifestHash(m) {
  const ordered = {
    file_id: m.file_id,
    filename: m.filename,
    size: m.size,
    chunk_size: m.chunk_size,
    nb_chunks: m.nb_chunks,
    chunks: m.chunks,
    sender_id: m.sender_id,
  };
  return sha256(Buffer.from(JSON.stringify(ordered)));
}

// Construit et signe le manifest d'un fichier existant.
function buildManifest(filePath, opts = {}) {
  const chunkSize = opts.chunkSize || DEFAULT_CHUNK_SIZE;
  const data = fs.readFileSync(filePath);
  const size = data.length;
  const nbChunks = Math.ceil(size / chunkSize);

  const chunks = [];
  for (let i = 0; i < nbChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, size);
    const cd = data.subarray(start, end);
    chunks.push({ index: i, hash: sha256(cd).toString("hex"), size: end - start });
  }

  const m = {
    file_id: sha256(data).toString("hex"),
    filename: opts.filename || path.basename(filePath),
    size,
    chunk_size: chunkSize,
    nb_chunks: nbChunks,
    chunks,
    sender_id: (opts.senderId || getPublicKey()).toString("hex"),
  };
  m.signature = sign(manifestHash(m)).toString("hex");
  return m;
}

// Vérifie la cohérence structurelle + la signature Ed25519 de l'émetteur.
function verifyManifest(m) {
  if (!m || typeof m !== "object") return false;
  if (!m.file_id || !Array.isArray(m.chunks)) return false;
  if (m.chunks.length !== m.nb_chunks) return false;
  const totalSize = m.chunks.reduce((a, c) => a + c.size, 0);
  if (totalSize !== m.size) return false;
  try {
    if (typeof sodium.crypto_sign_verify_detached !== "function") return false;
    return sodium.crypto_sign_verify_detached(
      Buffer.from(m.signature, "hex"),
      manifestHash(m),
      Buffer.from(m.sender_id, "hex")
    );
  } catch {
    return false;
  }
}

module.exports = { buildManifest, verifyManifest, manifestHash, sha256, DEFAULT_CHUNK_SIZE };
