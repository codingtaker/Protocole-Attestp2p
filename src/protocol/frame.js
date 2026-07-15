// Framing longueur-préfixée pour le transport de session (Sprint 3).
// Chaque message sur le fil : | len(4, UInt32BE) | payload(len) |.
// Gère la fragmentation TCP (payloads répartis sur plusieurs chunks) et les
// messages collés, et borne la taille annoncée pour éviter une allocation
// abusive (DoS).

const { SESSION_MAX_FRAME } = require("../config");

function encodeFrame(payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  return Buffer.concat([len, body]);
}

class FrameDecoder {
  constructor(maxFrame = SESSION_MAX_FRAME) {
    this.max = maxFrame;
    this.buf = Buffer.alloc(0);
  }

  // Ajoute un chunk et retourne la liste des payloads complets disponibles.
  // Lève si une taille annoncée dépasse la borne.
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames = [];

    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > this.max) {
        throw new Error("Frame trop grande (" + len + " > " + this.max + ")");
      }
      if (this.buf.length < 4 + len) break; // frame incomplète : on attend

      // Copie défensive : le payload survit aux réassignations de this.buf.
      frames.push(Buffer.from(this.buf.subarray(4, 4 + len)));
      this.buf = this.buf.subarray(4 + len);
    }

    return frames;
  }
}

module.exports = { encodeFrame, FrameDecoder };
