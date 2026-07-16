// Session chiffrée bout-en-bout au-dessus d'une socket TCP (Sprint 3).
// Handshake Noise-like (X25519 + HKDF) en frames longueur-préfixées, puis
// transport applicatif chiffré (XChaCha20-Poly1305).
//
// Clair transporté :
//   0x00 DATA  : | 0x00 | seq(8, UInt64BE) | body |   (séquence anti-rejeu intra-session)
//   0x01 REKEY / 0x02 REKEY_ACK / 0x03 CLOSE : | type |  (contrôle, sans corps)
//
// Défenses applicatives INTRA-session :
//   - anti-rejeu : la séquence DOIT être strictement croissante (rejeu / réordre rejeté)
//   - rate limit : borne de messages DATA par seconde et par session
//
// Rekey :
//   - manuel : conn.rekey()
//   - automatique (initiateur) : après N messages / N octets / N ms
//   Chaque direction avance sa clé en phase avec le flux TCP ordonné.
//
// Événements : "secure"(peerId) · "message"(clair) · "rekey" · "peerclose" ·
//              "error"(err) · "close"

const EventEmitter = require("events");
const { HandshakeInitiator, HandshakeResponder } = require("../crypto/handshake");
const { encodeFrame, FrameDecoder } = require("../protocol/frame");
const {
  SESSION_MAX_FRAME,
  SESSION_HANDSHAKE_TIMEOUT,
  SESSION_MAX_MSG_PER_SECOND,
  SESSION_REKEY_EVERY_MSGS,
  SESSION_REKEY_EVERY_BYTES,
  SESSION_REKEY_EVERY_MS,
} = require("../config");

const CTRL_DATA = 0x00;
const CTRL_REKEY = 0x01;
const CTRL_REKEY_ACK = 0x02;
const CTRL_CLOSE = 0x03;

class SecureConnection extends EventEmitter {
  constructor(socket, { initiator, security, maxMsgPerSecond, rekeyPolicy } = {}) {
    super();
    this.socket = socket;
    this.initiator = !!initiator;
    this.security = security || null;
    this.remoteIp = socket.remoteAddress;
    this.decoder = new FrameDecoder(SESSION_MAX_FRAME);
    this.hs = this.initiator ? new HandshakeInitiator() : new HandshakeResponder();
    this.session = null;
    this._step = 0;
    this._closed = false;

    // Défenses intra-session
    this.maxMsgPerSecond = maxMsgPerSecond || SESSION_MAX_MSG_PER_SECOND;
    this._txSeq = 0n;
    this._rxSeq = null;             // dernière séquence reçue (BigInt)
    this._msgWindowStart = Date.now();
    this._msgCount = 0;

    // Rekey automatique (initiateur uniquement)
    const rp = rekeyPolicy || {};
    this.rekeyEveryMsgs = rp.everyMsgs || SESSION_REKEY_EVERY_MSGS;
    this.rekeyEveryBytes = rp.everyBytes || SESSION_REKEY_EVERY_BYTES;
    this.rekeyEveryMs = rp.everyMs || SESSION_REKEY_EVERY_MS;
    this._rekeying = false;
    this._rk = { msgs: 0, bytes: 0, since: Date.now() };

    this._timeout = setTimeout(
      () => this._fail(new Error("timeout handshake")),
      SESSION_HANDSHAKE_TIMEOUT
    );
    if (this._timeout.unref) this._timeout.unref();

    socket.on("data", (d) => this._onData(d));
    socket.on("close", () => {
      this._closed = true;
      clearTimeout(this._timeout);
      if (this._rekeyTimer) clearInterval(this._rekeyTimer);
      this.emit("close");
    });
    socket.on("error", (e) => this._fail(e));

    if (this.initiator) this._write(this.hs.createMessage1());
  }

  _write(frame) {
    if (!this._closed) this.socket.write(encodeFrame(frame));
  }

  _report(type, meta) {
    if (this.security && typeof this.security.report === "function") {
      this.security.report(type, this.remoteIp, meta || {});
    }
  }

  // Envoie un message applicatif chiffré, préfixé du type DATA et d'une séquence.
  send(plaintext) {
    if (!this.session) throw new Error("session non établie");
    const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
    this._txSeq += 1n;
    const seq = Buffer.alloc(8);
    seq.writeBigUInt64BE(this._txSeq, 0);
    this._write(this.session.seal(Buffer.concat([Buffer.from([CTRL_DATA]), seq, body])));

    // Comptabilité rekey automatique.
    this._rk.msgs += 1;
    this._rk.bytes += body.length;
    this._maybeAutoRekey();
  }

  // Déclenche un renouvellement de clés (idempotent tant qu'un rekey est en cours).
  rekey() {
    if (!this.session || this._rekeying) return;
    this._rekeying = true;
    this._write(this.session.seal(Buffer.from([CTRL_REKEY])));
    this.session.rekeyTx();
  }

  _maybeAutoRekey() {
    if (!this.initiator || !this.session || this._rekeying) return;
    const elapsed = Date.now() - this._rk.since;
    if (this._rk.msgs >= this.rekeyEveryMsgs ||
        this._rk.bytes >= this.rekeyEveryBytes ||
        elapsed >= this.rekeyEveryMs) {
      this.rekey();
    }
  }

  // Fermeture propre : annonce CLOSE (chiffré) puis termine la socket.
  close() {
    if (this._closed) return;
    if (this.session) {
      try { this._write(this.session.seal(Buffer.from([CTRL_CLOSE]))); } catch { /* best-effort */ }
    }
    this.socket.end();
  }

  _msgAllow() {
    const now = Date.now();
    if (now - this._msgWindowStart > 1000) {
      this._msgWindowStart = now;
      this._msgCount = 0;
    }
    this._msgCount += 1;
    return this._msgCount <= this.maxMsgPerSecond;
  }

  _onData(chunk) {
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (e) {
      this._report("oversize_frame", { error: e.message });
      return this._fail(e);
    }
    for (const f of frames) {
      if (this.security && typeof this.security.allowFrame === "function" &&
          !this.security.allowFrame(this.remoteIp)) {
        this._report("rate_limit", {});
        return this._fail(new Error("rate limit dépassé"));
      }
      try {
        this._handleFrame(f);
      } catch (e) {
        this._report("crypto_error", { error: e.message });
        return this._fail(e);
      }
      if (this._closed) return;
    }
  }

  _handleFrame(frame) {
    // --- Phase transport (session établie) ---
    if (this.session) {
      const pt = this.session.open(frame);
      const type = pt.length > 0 ? pt[0] : CTRL_DATA;

      switch (type) {
        case CTRL_DATA: {
          if (pt.length < 9) throw new Error("DATA tronqué (séquence absente)");
          const seq = pt.readBigUInt64BE(1);
          const body = pt.subarray(9);

          // Rate limit intra-session.
          if (!this._msgAllow()) {
            this._report("session_rate_limit", {});
            return this._fail(new Error("rate limit session dépassé"));
          }
          // Anti-rejeu intra-session : séquence strictement croissante.
          if (this._rxSeq !== null && seq <= this._rxSeq) {
            this._report("session_replay", { seq: Number(seq) });
            return this._fail(new Error("rejeu applicatif détecté (seq " + seq + ")"));
          }
          this._rxSeq = seq;
          this.emit("message", Buffer.from(body));
          break;
        }
        case CTRL_REKEY:
          this.session.rekeyRx();
          this._write(this.session.seal(Buffer.from([CTRL_REKEY_ACK])));
          this.session.rekeyTx();
          this.emit("rekey");
          break;
        case CTRL_REKEY_ACK:
          this.session.rekeyRx();
          this._rekeying = false;
          this._rk = { msgs: 0, bytes: 0, since: Date.now() };
          this.emit("rekey");
          break;
        case CTRL_CLOSE:
          this.emit("peerclose");
          this._closed = true;
          this.socket.end();
          break;
        default:
          throw new Error("type de contrôle inconnu: " + type);
      }
      return;
    }

    // --- Phase handshake ---
    if (this.initiator) {
      const { message3, session } = this.hs.consumeMessage2(frame);
      this.session = session;
      this.peerId = session.peerId;
      this._write(message3);
      clearTimeout(this._timeout);
      this._startRekeyTimer();
      this.emit("secure", session.peerId);
    } else if (this._step === 0) {
      const msg2 = this.hs.consumeMessage1(frame);
      this._write(msg2);
      this._step = 1;
    } else {
      this.session = this.hs.consumeMessage3(frame);
      this.peerId = this.session.peerId;
      clearTimeout(this._timeout);
      this.emit("secure", this.session.peerId);
    }
  }

  // Rekey basé sur la durée (initiateur) : vérifie périodiquement même à l'idle.
  _startRekeyTimer() {
    if (!this.initiator) return;
    this._rekeyTimer = setInterval(() => this._maybeAutoRekey(), 1000);
    if (this._rekeyTimer.unref) this._rekeyTimer.unref();
  }

  _fail(err) {
    if (this._closed) return;
    this._closed = true;
    clearTimeout(this._timeout);
    if (this._rekeyTimer) clearInterval(this._rekeyTimer);
    this.emit("error", err);
    this.socket.destroy();
  }
}

module.exports = { SecureConnection, CTRL_DATA, CTRL_REKEY, CTRL_REKEY_ACK, CTRL_CLOSE };
