// Tests Sprint 2 : handshake Noise-like (X25519 + HKDF), blacklist IP temporaire,
// logs de tentative d'attaque + intégration serveur (IP bannie rejetée).
//
// ⚠️ HMAC_SECRET / IDENTITY_FILE / ATTACK_LOG_FILE définis AVANT require config.

const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.HMAC_SECRET = "attestp2p-secret-temp";
const TMP_IDENTITY = path.join(os.tmpdir(), "attestp2p-s2-" + process.pid + ".key");
const TMP_ATTACKLOG = path.join(os.tmpdir(), "attestp2p-s2-attacks-" + process.pid + ".log");
process.env.IDENTITY_FILE = TMP_IDENTITY;
process.env.ATTACK_LOG_FILE = TMP_ATTACKLOG;

const assert = require("assert");
const net = require("net");

const { initKeys } = require("../src/crypto/keys");
const { HandshakeInitiator, HandshakeResponder, MSG1_LEN } = require("../src/crypto/handshake");
const { IpBlacklist } = require("../src/network/ipBlacklist");
const { IpRateLimiter } = require("../src/network/ipRateLimiter");
const { ReplayGuard } = require("../src/protocol/replay");
const { logAttack } = require("../src/security/attackLog");
const { startTCPServer } = require("../src/network/tcpServer");

let passed = 0;
function ok(label) { passed++; console.log("✓ " + label); }

function cleanup() {
  try { fs.unlinkSync(TMP_IDENTITY); } catch {}
  try { fs.unlinkSync(TMP_ATTACKLOG); } catch {}
}

async function run() {
  console.log("🧪 Tests Sprint 2...\n");
  await initKeys();

  // --- 1. Handshake complet : mutual auth + AEAD bidirectionnel ---
  {
    const I = new HandshakeInitiator();
    const R = new HandshakeResponder();

    const m1 = I.createMessage1();
    const m2 = R.consumeMessage1(m1);
    const { message3, session: sI } = I.consumeMessage2(m2);
    const sR = R.consumeMessage3(message3);

    // Clés directionnelles cohérentes (tx d'un côté = rx de l'autre).
    assert.ok(sI.txKey.equals(sR.rxKey), "kI partagée");
    assert.ok(sR.txKey.equals(sI.rxKey), "kR partagée");
    assert.ok(!sI.txKey.equals(sI.rxKey), "clés directionnelles distinctes");
    assert.ok(sI.peerId.length === 32 && sR.peerId.length === 32, "peerId authentifié");

    // Chiffrement/déchiffrement AEAD dans les deux sens.
    const c1 = sI.seal(Buffer.from("I->R secret"));
    assert.strictEqual(sR.open(c1).toString(), "I->R secret", "I->R déchiffré");
    const c2 = sR.seal(Buffer.from("R->I secret"));
    assert.strictEqual(sI.open(c2).toString(), "R->I secret", "R->I déchiffré");
    ok("Handshake X25519+HKDF : session établie, AEAD bidirectionnel");

    // Altération du ciphertext → rejet.
    const bad = Buffer.from(c1); bad[bad.length - 1] ^= 0xff;
    assert.throws(() => sR.open(bad), "altération AEAD doit lever");
    ok("Session AEAD : altération détectée");
  }

  // --- 2. Handshake : rejets d'authentification ---
  {
    const R = new HandshakeResponder();
    assert.throws(() => R.consumeMessage1(Buffer.alloc(10)), /taille invalide/, "MSG1 court");

    const I = new HandshakeInitiator();
    const m1 = I.createMessage1();
    const forged = Buffer.from(m1);
    forged[MSG1_LEN - 1] ^= 0xff; // corrompt la signature
    assert.throws(() => new HandshakeResponder().consumeMessage1(forged), /signature.*invalide/, "sig initiateur falsifiée");
    ok("Handshake : message mal formé et signature falsifiée rejetés");
  }

  // --- 3. Blacklist IP : strikes, ban, expiration ---
  {
    const bl = new IpBlacklist({ banMs: 1000, strikeThreshold: 3, strikeWindowMs: 10000 });
    const ip = "9.9.9.9";
    const t = 100000;
    assert.strictEqual(bl.strike(ip, t).banned, false, "1er strike");
    assert.strictEqual(bl.strike(ip, t).banned, false, "2e strike");
    assert.strictEqual(bl.strike(ip, t).banned, true, "3e strike → ban");
    assert.strictEqual(bl.isBanned(ip, t), true, "banni pendant la fenêtre");
    assert.strictEqual(bl.isBanned(ip, t + 1001), false, "réhabilité après expiration");

    bl.ban("1.1.1.1", t);
    assert.strictEqual(bl.isBanned("1.1.1.1", t + 500), true, "ban explicite actif");
    ok("Blacklist IP : ban au seuil + expiration automatique");
  }

  // --- 4. attackLog : écriture structurée ---
  {
    const entry = logAttack("unit_test", "2.2.2.2", { note: "sprint2" });
    assert.strictEqual(entry.type, "unit_test");
    assert.strictEqual(entry.ip, "2.2.2.2");
    const content = fs.readFileSync(TMP_ATTACKLOG, "utf8");
    assert.ok(content.includes("unit_test") && content.includes("2.2.2.2"), "ligne journalisée");
    ok("attackLog : événement journalisé (console + fichier)");
  }

  // --- 5. Intégration : IP bannie après infractions, reconnexion refusée ---
  await integrationBan();
  ok("Intégration TCP : IP bannie après infractions répétées");

  console.log("\n🎉 Tous les tests Sprint 2 sont PASSÉS (" + passed + ") !");
}

function integrationBan() {
  return new Promise((resolve, reject) => {
    const blacklist = new IpBlacklist({ banMs: 60000, strikeThreshold: 2, strikeWindowMs: 60000 });
    const server = startTCPServer(0, {
      blacklist,
      replayGuard: new ReplayGuard(),
      ipRateLimiter: new IpRateLimiter(10000, 1000),
    });

    server.on("listening", () => {
      const { port } = server.address();

      // Envoie un paquet malformé (MAGIC invalide) puis attend la fermeture.
      function junkShot() {
        return new Promise((res) => {
          const c = net.connect(port, "127.0.0.1", () => c.write(Buffer.alloc(50)));
          c.on("close", res);
          c.on("error", res);
        });
      }

      (async () => {
        try {
          // 2 infractions → seuil atteint → IP bannie.
          await junkShot();
          await junkShot();
          await new Promise((r) => setTimeout(r, 50));

          assert.ok(blacklist.bannedCount() >= 1, "au moins une IP bannie");

          // Reconnexion : doit être fermée immédiatement (banned_reconnect).
          await new Promise((res, rej) => {
            const c = net.connect(port, "127.0.0.1");
            const timer = setTimeout(() => rej(new Error("reconnexion non refusée")), 2000);
            c.on("close", () => { clearTimeout(timer); res(); });
            c.on("error", () => { clearTimeout(timer); res(); });
          });

          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      })();
    });

    server.on("error", reject);
  });
}

run()
  .then(() => { cleanup(); process.exit(0); })
  .catch((err) => { cleanup(); console.error("\nÉchec des tests Sprint 2 :", err.message); process.exit(1); });
