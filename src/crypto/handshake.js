// Handshake sécurisé « Noise-like » : X25519 (échange de clés éphémère,
// forward secrecy) + HKDF-SHA256 (dérivation de clés directionnelles) +
// authentification mutuelle par signature Ed25519 du transcript (SIGMA-like).
//
// Déroulé (I = initiateur, R = répondeur) :
//   MSG1  I → R : ePubI(32) | idI(32) | sig_idI(ePubI)          (128 o)
//   MSG2  R → I : ePubR(32) | idR(32) | sig_idR(ePubR || ePubI) (128 o)
//   MSG3  I → R : sig_idI(ePubI || ePubR)                        (64 o)
//
// Après MSG2/MSG3, chaque côté dérive dh = X25519(e_priv, ePub_pair) puis :
//   kI = HKDF(dh, "AttestP2P I->R")   kR = HKDF(dh, "AttestP2P R->I")
// L'initiateur émet avec kI / reçoit avec kR ; le répondeur l'inverse.
// La session chiffre/authentifie via XChaCha20-Poly1305 (AEAD).

const crypto = require("crypto");
const sodium = require("libsodium-wrappers");
const { sign, getPublicKey } = require("./keys");

const HKDF_SALT = Buffer.from("AttestP2P-noise-v1");
const REKEY_SALT = Buffer.from("AttestP2P-rekey-v1");
const KEYLEN = 32;
const EPUB_LEN = 32;
const ID_LEN = 32;
const SIG_LEN = 64;
const MSG1_LEN = EPUB_LEN + ID_LEN + SIG_LEN; // 128
const MSG2_LEN = EPUB_LEN + ID_LEN + SIG_LEN; // 128
const MSG3_LEN = SIG_LEN;                     // 64

function ensureReady() {
  if (typeof sodium.crypto_scalarmult !== "function") {
    throw new Error("libsodium non initialisé : appelez initKeys() (ou await sodium.ready) avant le handshake");
  }
}

function hkdf(ikm, info) {
  return Buffer.from(
    crypto.hkdfSync("sha256", ikm, HKDF_SALT, Buffer.from(info), KEYLEN)
  );
}

// Avance une clé de session (rekey unidirectionnel, sens unique/forward-secret).
function deriveRekey(key) {
  return Buffer.from(crypto.hkdfSync("sha256", key, REKEY_SALT, Buffer.from("AttestP2P rekey"), KEYLEN));
}

function deriveSessionKeys(dh) {
  return {
    kI: hkdf(dh, "AttestP2P I->R"),
    kR: hkdf(dh, "AttestP2P R->I"),
  };
}

// Canal sécurisé issu du handshake : AEAD XChaCha20-Poly1305, nonce aléatoire
// préfixé au ciphertext.
class SecureSession {
  constructor(txKey, rxKey, peerId) {
    this.txKey = txKey;
    this.rxKey = rxKey;
    this.peerId = peerId; // Buffer, clé publique Ed25519 du pair authentifié
  }

  seal(plaintext, aad = null) {
    const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
    const NP = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
    const nonce = crypto.randomBytes(NP);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      pt, aad, null, nonce, this.txKey
    );
    return Buffer.concat([nonce, Buffer.from(ct)]);
  }

  open(sealed, aad = null) {
    const NP = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
    if (!Buffer.isBuffer(sealed) || sealed.length < NP) {
      throw new Error("open : message chiffré trop court");
    }
    const nonce = sealed.subarray(0, NP);
    const ct = sealed.subarray(NP);
    const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, ct, aad, nonce, this.rxKey
    );
    return Buffer.from(pt);
  }

  // Rekey par direction : la clé d'émission est avancée à l'envoi d'un
  // contrôle REKEY, la clé de réception à sa réception — en phase avec le
  // flux ordonné TCP de chaque sens.
  rekeyTx() {
    this.txKey = deriveRekey(this.txKey);
    this.txGen = (this.txGen || 0) + 1;
  }

  rekeyRx() {
    this.rxKey = deriveRekey(this.rxKey);
    this.rxGen = (this.rxGen || 0) + 1;
  }
}

class HandshakeInitiator {
  constructor() {
    ensureReady();
    const e = sodium.crypto_kx_keypair();       // paire X25519 éphémère
    this.ePriv = Buffer.from(e.privateKey);
    this.ePub = Buffer.from(e.publicKey);
    this.id = getPublicKey();
    this.done = false;
  }

  createMessage1() {
    const sig = sign(this.ePub); // l'identité signe sa clé éphémère
    return Buffer.concat([this.ePub, this.id, sig]);
  }

  consumeMessage2(msg2) {
    if (!Buffer.isBuffer(msg2) || msg2.length !== MSG2_LEN) {
      throw new Error("Handshake : MSG2 de taille invalide");
    }
    const rEpub = msg2.subarray(0, EPUB_LEN);
    const rId = msg2.subarray(EPUB_LEN, EPUB_LEN + ID_LEN);
    const rSig = msg2.subarray(EPUB_LEN + ID_LEN, MSG2_LEN);

    const transcript = Buffer.concat([rEpub, this.ePub]);
    if (!sodium.crypto_sign_verify_detached(rSig, transcript, rId)) {
      throw new Error("Handshake : signature du répondeur invalide");
    }

    const dh = Buffer.from(sodium.crypto_scalarmult(this.ePriv, rEpub));
    const { kI, kR } = deriveSessionKeys(dh);
    this.session = new SecureSession(kI, kR, Buffer.from(rId));

    const sig3 = sign(Buffer.concat([this.ePub, rEpub]));
    this.done = true;
    return { message3: sig3, session: this.session };
  }
}

class HandshakeResponder {
  constructor() {
    ensureReady();
    const e = sodium.crypto_kx_keypair();
    this.ePriv = Buffer.from(e.privateKey);
    this.ePub = Buffer.from(e.publicKey);
    this.id = getPublicKey();
    this.done = false;
  }

  consumeMessage1(msg1) {
    if (!Buffer.isBuffer(msg1) || msg1.length !== MSG1_LEN) {
      throw new Error("Handshake : MSG1 de taille invalide");
    }
    const iEpub = msg1.subarray(0, EPUB_LEN);
    const iId = msg1.subarray(EPUB_LEN, EPUB_LEN + ID_LEN);
    const iSig = msg1.subarray(EPUB_LEN + ID_LEN, MSG1_LEN);

    if (!sodium.crypto_sign_verify_detached(iSig, iEpub, iId)) {
      throw new Error("Handshake : signature de l'initiateur invalide");
    }
    this.iEpub = Buffer.from(iEpub);
    this.iId = Buffer.from(iId);

    const dh = Buffer.from(sodium.crypto_scalarmult(this.ePriv, iEpub));
    const { kI, kR } = deriveSessionKeys(dh);
    // Répondeur : émet avec kR, reçoit avec kI (miroir de l'initiateur).
    this.session = new SecureSession(kR, kI, this.iId);

    const sig2 = sign(Buffer.concat([this.ePub, iEpub]));
    return Buffer.concat([this.ePub, this.id, sig2]);
  }

  consumeMessage3(msg3) {
    if (!Buffer.isBuffer(msg3) || msg3.length !== MSG3_LEN) {
      throw new Error("Handshake : MSG3 de taille invalide");
    }
    const transcript = Buffer.concat([this.iEpub, this.ePub]);
    if (!sodium.crypto_sign_verify_detached(msg3, transcript, this.iId)) {
      throw new Error("Handshake : confirmation de l'initiateur invalide");
    }
    this.done = true;
    return this.session;
  }
}

module.exports = {
  HandshakeInitiator,
  HandshakeResponder,
  SecureSession,
  MSG1_LEN,
  MSG2_LEN,
  MSG3_LEN,
};
