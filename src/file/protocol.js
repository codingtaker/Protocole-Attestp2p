// Module 3.3 — Protocole de transfert de chunk (messages applicatifs transportés
// DANS la session chiffrée ; CHUNK_DATA est donc chiffré avec la clé de session).
//
// Chaque message = | type(1) | corps |
//   0x10 MANIFEST    : JSON du manifest
//   0x14 HAVE        : file_id(32) | bitfield(N)
//   0x15 HAVE_PIECE  : file_id(32) | idx(4)         (annonce d'un chunk acquis)
//   0x11 CHUNK_REQ   : file_id(32) | idx(4)
//   0x12 CHUNK_DATA  : file_id(32) | idx(4) | chunk_hash(32) | sig(64) | data(...)
//   0x13 ACK         : idx(4) | status(1)   (0x00 OK, 0x01 HASH_MISMATCH, 0x02 NOT_FOUND)

const T = {
  MANIFEST: 0x10,
  CHUNK_REQ: 0x11,
  CHUNK_DATA: 0x12,
  ACK: 0x13,
  HAVE: 0x14,
  HAVE_PIECE: 0x15,
};

const ACK_OK = 0x00;
const ACK_HASH_MISMATCH = 0x01;
const ACK_NOT_FOUND = 0x02;

const fromHex = (h) => Buffer.from(h, "hex");
const idBuf = (fileId) => (Buffer.isBuffer(fileId) ? fileId : fromHex(fileId));

function encManifest(manifest) {
  return Buffer.concat([Buffer.from([T.MANIFEST]), Buffer.from(JSON.stringify(manifest))]);
}
function encHave(fileId, bitfield) {
  return Buffer.concat([Buffer.from([T.HAVE]), idBuf(fileId), bitfield]);
}
function encHavePiece(fileId, idx) {
  const b = Buffer.alloc(4); b.writeUInt32BE(idx, 0);
  return Buffer.concat([Buffer.from([T.HAVE_PIECE]), idBuf(fileId), b]);
}
function encChunkReq(fileId, idx) {
  const b = Buffer.alloc(4); b.writeUInt32BE(idx, 0);
  return Buffer.concat([Buffer.from([T.CHUNK_REQ]), idBuf(fileId), b]);
}
function encChunkData(fileId, idx, chunkHash, signature, data) {
  const b = Buffer.alloc(4); b.writeUInt32BE(idx, 0);
  return Buffer.concat([Buffer.from([T.CHUNK_DATA]), idBuf(fileId), b, idBuf(chunkHash), signature, data]);
}
function encAck(idx, status) {
  const b = Buffer.alloc(5); b.writeUInt32BE(idx, 0); b[4] = status;
  return Buffer.concat([Buffer.from([T.ACK]), b]);
}

function decode(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1) throw new Error("message vide");
  const type = buf[0];
  const p = buf.subarray(1);
  switch (type) {
    case T.MANIFEST:
      return { type, manifest: JSON.parse(p.toString()) };
    case T.HAVE:
      return { type, fileId: p.subarray(0, 32).toString("hex"), bitfield: p.subarray(32) };
    case T.HAVE_PIECE:
      return { type, fileId: p.subarray(0, 32).toString("hex"), idx: p.readUInt32BE(32) };
    case T.CHUNK_REQ:
      return { type, fileId: p.subarray(0, 32).toString("hex"), idx: p.readUInt32BE(32) };
    case T.CHUNK_DATA:
      return {
        type,
        fileId: p.subarray(0, 32).toString("hex"),
        idx: p.readUInt32BE(32),
        chunkHash: p.subarray(36, 68),
        signature: p.subarray(68, 132),
        data: p.subarray(132),
      };
    case T.ACK:
      return { type, idx: p.readUInt32BE(0), status: p[4] };
    default:
      throw new Error("type de message fichier inconnu: " + type);
  }
}

module.exports = {
  T, ACK_OK, ACK_HASH_MISMATCH, ACK_NOT_FOUND,
  encManifest, encHave, encHavePiece, encChunkReq, encChunkData, encAck, decode,
};
