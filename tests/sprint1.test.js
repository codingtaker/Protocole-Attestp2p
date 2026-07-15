// Tests Sprint 1 : non-régression sur les défenses Sprint 0 + nouvelles briques
// (identité persistée, anti-replay, rate limit par IP, enveloppe de message).
//
// ⚠️ HMAC_SECRET et IDENTITY_FILE doivent être définis AVANT de require config.js.

const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.HMAC_SECRET = "attestp2p-secret-temp";
const TMP_IDENTITY = path.join(os.tmpdir(), "attestp2p-test-" + process.pid + ".key");
process.env.IDENTITY_FILE = TMP_IDENTITY;

const assert = require("assert");
const net = require("net");

const {
  buildPacket,
  parsePacket,
  verifyPacket,
  verifySignature,
  extractPackets,
  MIN_PACKET_LEN,
} = require("../src/protocol/packet");
const { wrapPayload, unwrapPayload, REPLAY_ENVELOPE_LEN } = (() => {
  const m = require("../src/protocol/message");
  return { ...m, REPLAY_ENVELOPE_LEN: require("../src/config").REPLAY_ENVELOPE_LEN };
})();
const { ReplayGuard } = require("../src/protocol/replay");
const { IpRateLimiter } = require("../src/network/ipRateLimiter");
const { startTCPServer } = require("../src/network/tcpServer");
const { initKeys, getPublicKey } = require("../src/crypto/keys");
const { MAGIC } = require("../src/config");

let passed = 0;
function ok(label) { passed++; console.log("✓ " + label); }

async function run() {
  console.log("🧪 Tests Sprint 1...\n");

  await initKeys();

  // --- 1. Identité persistée : nodeId stable entre deux inits ---
  const pub1 = getPublicKey().toString("hex");
  delete require.cache[require.resolve("../src/crypto/keys")];
  const keys2 = require("../src/crypto/keys");
  await keys2.initKeys();
  const pub2 = keys2.getPublicKey().toString("hex");
  assert.strictEqual(pub1, pub2, "nodeId doit être stable via la seed persistée");
  ok("Identité persistée : nodeId stable après redémarrage");

  // --- 2. Enveloppe message : wrap/unwrap round-trip ---
  const data = Buffer.from("Hello Sprint 1");
  const env = wrapPayload(data);
  assert.strictEqual(env.length, REPLAY_ENVELOPE_LEN + data.length, "taille enveloppe");
  const un = unwrapPayload(env);
  assert.strictEqual(un.data.toString(), "Hello Sprint 1", "data round-trip");
  assert.strictEqual(un.nonce.length, 16, "nonce 16 octets");
  assert.ok(Math.abs(Date.now() - un.timestamp) < 2000, "timestamp frais");
  ok("Enveloppe timestamp+nonce : round-trip");

  assert.throws(() => unwrapPayload(Buffer.alloc(10)), /trop court/, "payload court doit lever");
  ok("unwrapPayload rejette un payload trop court");

  // --- 3. verifyPacket : garde-fous ---
  const good = buildPacket(0x01, wrapPayload(Buffer.from("ok")));
  assert.strictEqual(verifyPacket(good), true, "paquet valide");
  assert.strictEqual(verifyPacket(Buffer.alloc(MIN_PACKET_LEN - 1)), false, "buffer trop court");
  const badMagic = Buffer.from(good);
  badMagic[0] = 0x00; // casse le MAGIC
  assert.strictEqual(verifyPacket(badMagic), false, "MAGIC invalide");
  ok("verifyPacket : buffer court + MAGIC invalide rejetés");

  // --- 4. verifySignature : signature falsifiée ---
  const parsed = parsePacket(good);
  assert.strictEqual(verifySignature(parsed), true, "signature valide");
  const forged = { ...parsed, signature: Buffer.from(parsed.signature) };
  forged.signature[0] ^= 0xff; // corrompt la signature
  assert.strictEqual(verifySignature(forged), false, "signature falsifiée doit échouer");
  ok("verifySignature : signature falsifiée rejetée");

  // --- 5. parsePacket : préconditions défensives ---
  assert.throws(() => parsePacket(Buffer.alloc(10)), /trop court/, "buffer court");
  const incoherent = Buffer.from(good);
  incoherent.writeUInt32BE(500000, 37); // payloadLen incohérent avec la taille réelle
  assert.throws(() => parsePacket(incoherent), /incohérent/, "payloadLen incohérent");
  ok("parsePacket : buffer court + payloadLen incohérent rejetés");

  // --- 6. extractPackets : MAGIC invalide lève ---
  const junk = Buffer.concat([Buffer.from("XXXX"), Buffer.alloc(MIN_PACKET_LEN)]);
  assert.throws(() => extractPackets(junk), /Invalid MAGIC/, "MAGIC invalide doit lever");
  ok("extractPackets : MAGIC invalide lève");

  // --- 7. IpRateLimiter : borne cumulée par IP ---
  const rl = new IpRateLimiter(3, 1000);
  const t0 = 1000;
  assert.strictEqual(rl.allow("1.2.3.4", t0), true);
  assert.strictEqual(rl.allow("1.2.3.4", t0), true);
  assert.strictEqual(rl.allow("1.2.3.4", t0), true);
  assert.strictEqual(rl.allow("1.2.3.4", t0), false, "4e paquet dans la fenêtre → bloqué");
  assert.strictEqual(rl.allow("1.2.3.4", t0 + 1001), true, "nouvelle fenêtre → autorisé");
  assert.strictEqual(rl.allow("5.6.7.8", t0), true, "autre IP indépendante");
  ok("IpRateLimiter : quota par IP appliqué");

  // --- 8. ReplayGuard : fraîcheur + unicité ---
  const rg = new ReplayGuard({ windowMs: 30000 });
  const nid = getPublicKey();
  const now = Date.now();
  const nonceA = Buffer.alloc(16, 1);
  assert.strictEqual(rg.check(nid, now, nonceA, now).ok, true, "1er passage accepté");
  assert.strictEqual(rg.check(nid, now, nonceA, now).ok, false, "rejeu du même nonce refusé");
  const stale = rg.check(nid, now - 60000, Buffer.alloc(16, 2), now);
  assert.strictEqual(stale.ok, false, "timestamp périmé refusé");
  ok("ReplayGuard : rejeu et timestamp périmé refusés");

  // --- 9. Intégration TCP : paquet valide accepté, rejeu rejeté (socket fermée) ---
  await integrationReplay();
  ok("Intégration TCP : rejeu détecté et connexion fermée");

  console.log("\n🎉 Tous les tests Sprint 1 sont PASSÉS (" + passed + ") !");
}

function integrationReplay() {
  return new Promise((resolve, reject) => {
    const replayGuard = new ReplayGuard();
    const ipRateLimiter = new IpRateLimiter(1000, 1000);
    const server = startTCPServer(0, { replayGuard, ipRateLimiter });

    server.on("listening", () => {
      const { port } = server.address();
      const packet = buildPacket(0x01, wrapPayload(Buffer.from("replay-me")));

      const client = net.connect(port, "127.0.0.1", () => {
        // 1er envoi : valide. 2e envoi (mêmes octets) : rejeu → serveur ferme.
        client.write(packet);
        setTimeout(() => client.write(packet), 100);
      });

      let closed = false;
      const done = (err) => {
        if (closed) return;
        closed = true;
        try { client.destroy(); } catch {}
        server.close(() => (err ? reject(err) : resolve()));
      };

      // Le serveur détruit la socket sur rejeu → le client voit close.
      client.on("close", () => done());
      client.on("error", () => done()); // ECONNRESET attendu à la fermeture serveur
      setTimeout(() => done(new Error("timeout : rejeu non détecté")), 3000);
    });

    server.on("error", reject);
  });
}

run()
  .then(() => {
    try { fs.unlinkSync(TMP_IDENTITY); } catch {}
    process.exit(0);
  })
  .catch((err) => {
    try { fs.unlinkSync(TMP_IDENTITY); } catch {}
    console.error("\nÉchec des tests Sprint 1 :", err.message);
    process.exit(1);
  });
