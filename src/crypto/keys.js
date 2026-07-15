// Gestion des clés Ed25519 avec libsodium.
// L'identité (paire de clés) est dérivée d'une seed de 32 octets persistée sur
// disque : le nodeId reste stable entre les redémarrages (prérequis pour une
// notion de pair connu / réputation). Le fichier seed est ignoré par git (*.key).

const fs = require("fs");
const sodium = require("libsodium-wrappers");
const { IDENTITY_FILE } = require("../config");

let keyPair = null;

// Charge la seed depuis le disque, ou en génère une nouvelle et la persiste.
function loadOrCreateSeed() {
  if (fs.existsSync(IDENTITY_FILE)) {
    const hex = fs.readFileSync(IDENTITY_FILE, "utf8").trim();
    const seed = Buffer.from(hex, "hex");
    if (seed.length !== sodium.crypto_sign_SEEDBYTES) {
      throw new Error(
        `Seed d'identité invalide dans ${IDENTITY_FILE} (attendu ${sodium.crypto_sign_SEEDBYTES} octets)`
      );
    }
    return seed;
  }

  const seed = Buffer.from(sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES));
  // Écriture en 0o600 : lisible uniquement par le propriétaire.
  fs.writeFileSync(IDENTITY_FILE, seed.toString("hex"), { mode: 0o600 });
  return seed;
}

async function initKeys() {
  await sodium.ready;

  const seed = loadOrCreateSeed();
  keyPair = sodium.crypto_sign_seed_keypair(seed);

  const pub = Buffer.from(keyPair.publicKey).toString("hex");
  console.log("🔐 Identité Ed25519 chargée");
  console.log("Public Key (nodeId):", pub);
}

function getPublicKey() {
  if (!keyPair) {
    throw new Error("Clés non initialisées : appelez await initKeys() d'abord");
  }
  return Buffer.from(keyPair.publicKey);
}

function sign(dataBuffer) {
  if (!keyPair) {
    throw new Error("Clés non initialisées : appelez await initKeys() d'abord");
  }
  return Buffer.from(
    sodium.crypto_sign_detached(dataBuffer, keyPair.privateKey)
  );
}

module.exports = {
  initKeys,
  getPublicKey,
  sign,
};
