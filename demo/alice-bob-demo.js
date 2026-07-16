// LIVRABLE SPRINT 2 — Démo : Alice envoie un message chiffré à Bob.
//
// Bob (serveur de sessions chiffrées) et Alice (client) réalisent le handshake
// Noise-like (X25519 + HKDF), puis Alice envoie un message applicatif chiffré
// (XChaCha20-Poly1305). On capture TOUS les octets qui transitent réellement sur
// la socket TCP, dans les deux sens, et on prouve que le message en clair
// N'APPARAÎT PAS sur le fil. Les octets capturés sont écrits dans un vrai fichier
// .pcap ouvrable avec Wireshark.
//
// Sortie : demo/alice-bob.pcap  +  demo/capture-proof.txt

const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.HMAC_SECRET = process.env.HMAC_SECRET || "demo-sprint2";
process.env.IDENTITY_FILE = path.join(os.tmpdir(), "attestp2p-demo-" + process.pid + ".key");

const { initKeys } = require("../src/crypto/keys");
const { startSecureServer } = require("../src/network/secureServer");
const { connectSecure } = require("../src/network/secureClient");

const SECRET = "Rendez-vous 14h porte Est -- code: SPRINT2-SECRET-1337";
const OUT_PCAP = path.join(__dirname, "alice-bob.pcap");
const OUT_PROOF = path.join(__dirname, "capture-proof.txt");

// ----------------------------------------------------------------------------
// Construction d'un fichier PCAP (DLT_RAW = IPv4 brut) à partir des segments TCP
// réellement observés. Chaque enregistrement : IPv4(20) + TCP(20) + payload.
// ----------------------------------------------------------------------------
function ipChecksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) sum += buf.readUInt16BE(i);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}
function tcpChecksum(srcIp, dstIp, tcp) {
  const pseudo = Buffer.alloc(12);
  srcIp.copy(pseudo, 0); dstIp.copy(pseudo, 4);
  pseudo[9] = 6; pseudo.writeUInt16BE(tcp.length, 10);
  const all = Buffer.concat([pseudo, tcp]);
  let sum = 0;
  for (let i = 0; i + 1 < all.length; i += 2) sum += all.readUInt16BE(i);
  if (all.length % 2) sum += all[all.length - 1] << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}
const ipBuf = (s) => Buffer.from(s.split(".").map(Number));

function buildSegment({ srcIp, dstIp, srcPort, dstPort, seq, ack, payload }) {
  const ip = Buffer.alloc(20);
  ip[0] = 0x45; ip[1] = 0x00;
  ip.writeUInt16BE(20 + 20 + payload.length, 2);
  ip.writeUInt16BE((Math.random() * 65535) | 0, 4);
  ip.writeUInt16BE(0x4000, 6); // DF
  ip[8] = 64; ip[9] = 6;       // TTL, proto=TCP
  ipBuf(srcIp).copy(ip, 12); ipBuf(dstIp).copy(ip, 16);
  ip.writeUInt16BE(ipChecksum(ip), 10);

  const tcp = Buffer.alloc(20);
  tcp.writeUInt16BE(srcPort, 0); tcp.writeUInt16BE(dstPort, 2);
  tcp.writeUInt32BE(seq >>> 0, 4); tcp.writeUInt32BE(ack >>> 0, 8);
  tcp[12] = 0x50;               // data offset 5
  tcp[13] = 0x18;               // PSH + ACK
  tcp.writeUInt16BE(65535, 14);
  const full = Buffer.concat([tcp, payload]);
  tcp.writeUInt16BE(tcpChecksum(ipBuf(srcIp), ipBuf(dstIp), full), 16);

  return Buffer.concat([ip, tcp, payload]);
}

function writePcap(records, meta) {
  const gh = Buffer.alloc(24);
  gh.writeUInt32BE(0xa1b2c3d4, 0);   // magic
  gh.writeUInt16BE(2, 4); gh.writeUInt16BE(4, 6);
  gh.writeUInt32BE(65535, 16);
  gh.writeUInt32BE(101, 20);         // DLT_RAW (IPv4 brut)

  const seq = { a2b: 1, b2a: 1 };
  const parts = [gh];
  for (const r of records) {
    const isA2B = r.dir === "a2b";
    const seg = buildSegment({
      srcIp: "127.0.0.1", dstIp: "127.0.0.1",
      srcPort: isA2B ? meta.alicePort : meta.bobPort,
      dstPort: isA2B ? meta.bobPort : meta.alicePort,
      seq: isA2B ? seq.a2b : seq.b2a,
      ack: isA2B ? seq.b2a : seq.a2b,
      payload: r.data,
    });
    if (isA2B) seq.a2b += r.data.length; else seq.b2a += r.data.length;

    const rec = Buffer.alloc(16);
    rec.writeUInt32BE(Math.floor(r.ts / 1000), 0);
    rec.writeUInt32BE((r.ts % 1000) * 1000, 4);
    rec.writeUInt32BE(seg.length, 8);
    rec.writeUInt32BE(seg.length, 12);
    parts.push(rec, seg);
  }
  fs.writeFileSync(OUT_PCAP, Buffer.concat(parts));
}

function hexdump(buf, max = 160) {
  const b = buf.subarray(0, max);
  let out = "";
  for (let i = 0; i < b.length; i += 16) {
    const slice = b.subarray(i, i + 16);
    const hex = [...slice].map((x) => x.toString(16).padStart(2, "0")).join(" ");
    const asc = [...slice].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    out += "  " + i.toString(16).padStart(4, "0") + "  " + hex.padEnd(48) + "  " + asc + "\n";
  }
  if (buf.length > max) out += "  ... (" + (buf.length - max) + " octets de plus)\n";
  return out;
}

// ----------------------------------------------------------------------------
async function main() {
  await initKeys();
  const records = [];
  let bobPlaintext = null;
  let dataFrame = null;

  const server = startSecureServer(0, (conn) => {
    // Capture Alice -> Bob (tout ce que Bob reçoit).
    conn.socket.on("data", (c) => records.push({ dir: "a2b", data: Buffer.from(c), ts: Date.now() }));
    conn.on("message", (m) => { bobPlaintext = m.toString(); });
  });

  await new Promise((res) => server.on("listening", res));
  const bobPort = server.address().port;

  await new Promise((resolve) => {
    const alice = connectSecure(bobPort, "127.0.0.1", (conn) => {
      // Le dernier segment Alice->Bob après "secure" = la frame du message chiffré.
      conn.send(Buffer.from(SECRET));
    });
    // Capture Bob -> Alice.
    alice.socket.on("data", (c) => records.push({ dir: "b2a", data: Buffer.from(c), ts: Date.now() }));
    alice.on("secure", () => { main._alicePort = alice.socket.localPort; });
    setTimeout(resolve, 600);
  });

  // La frame chiffrée du message = dernier segment Alice->Bob.
  const a2b = records.filter((r) => r.dir === "a2b");
  dataFrame = a2b[a2b.length - 1].data;

  writePcap(records, { alicePort: main._alicePort || 50000, bobPort });

  // ---- Preuves ----
  const allWire = Buffer.concat(records.map((r) => r.data));
  const leakPlain = allWire.includes(Buffer.from(SECRET));
  const totalBytes = allWire.length;

  const proof = [
    "=== LIVRABLE SPRINT 2 — Démo session chiffrée Alice -> Bob ===",
    "",
    "Message en clair envoyé par Alice :",
    "  \"" + SECRET + "\"",
    "",
    "Message déchiffré par Bob (après handshake + AEAD) :",
    "  \"" + bobPlaintext + "\"",
    "  -> déchiffrement correct : " + (bobPlaintext === SECRET),
    "",
    "Octets réellement transmis sur la socket TCP : " + totalBytes + " octets (" + records.length + " segments)",
    "Le clair \"SPRINT2-SECRET-1337\" apparaît-il sur le fil ? " + (leakPlain ? "OUI (FUITE!)" : "NON"),
    "",
    "Frame du message chiffré observée sur le réseau (" + dataFrame.length + " octets) — hexdump :",
    hexdump(dataFrame),
    "Capture réseau complète : demo/alice-bob.pcap",
    "  Ouvrir avec Wireshark, puis clic droit sur un segment -> \"Follow > TCP Stream\" :",
    "  le contenu est uniquement du chiffré (aucun texte lisible).",
    "",
  ].join("\n");

  fs.writeFileSync(OUT_PROOF, proof);
  console.log(proof);

  server.close();
  try { fs.unlinkSync(process.env.IDENTITY_FILE); } catch {}

  if (bobPlaintext !== SECRET) { console.error("ÉCHEC : Bob n'a pas déchiffré correctement"); process.exit(1); }
  if (leakPlain) { console.error("ÉCHEC : le clair a fuité sur le réseau"); process.exit(1); }
  console.log("✅ Démo OK : Bob a déchiffré, et le réseau ne montre que du chiffré.");
  process.exit(0);
}

main().catch((e) => { console.error("Erreur démo:", e.message); process.exit(1); });
