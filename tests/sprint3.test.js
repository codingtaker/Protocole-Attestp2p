// Tests Sprint 3 : session chiffrée E2E par handshake, défenses sur le serveur
// sécurisé, renouvellement de clés (rekey), fermeture propre, et ouverture
// automatique de sessions vers les pairs découverts (PeerManager).

const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.HMAC_SECRET = "attestp2p-secret-temp";
process.env.IDENTITY_FILE = path.join(os.tmpdir(), "attestp2p-s3-" + process.pid + ".key");
process.env.ATTACK_LOG_FILE = path.join(os.tmpdir(), "attestp2p-s3-attacks-" + process.pid + ".log");

const assert = require("assert");
const net = require("net");

const { initKeys, getPublicKey } = require("../src/crypto/keys");
const { encodeFrame, FrameDecoder } = require("../src/protocol/frame");
const { startSecureServer } = require("../src/network/secureServer");
const { connectSecure } = require("../src/network/secureClient");
const { SecureConnection } = require("../src/session/secureConnection");
const { PeerManager } = require("../src/session/peerManager");
const { IpBlacklist } = require("../src/network/ipBlacklist");
const { SESSION_MAX_FRAME } = require("../src/config");

let passed = 0;
function ok(label) { passed++; console.log("✓ " + label); }
function cleanup() {
  try { fs.unlinkSync(process.env.IDENTITY_FILE); } catch {}
  try { fs.unlinkSync(process.env.ATTACK_LOG_FILE); } catch {}
}

async function run() {
  console.log("🧪 Tests Sprint 3...\n");
  await initKeys();

  // --- 1. Framing ---
  {
    const dec = new FrameDecoder();
    const out = dec.push(Buffer.concat([encodeFrame(Buffer.from("alpha")), encodeFrame(Buffer.from("beta"))]));
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].toString(), "alpha");
    assert.strictEqual(out[1].toString(), "beta");
    const f3 = encodeFrame(Buffer.from("gamma"));
    assert.strictEqual(dec.push(f3.subarray(0, 3)).length, 0);
    assert.strictEqual(dec.push(f3.subarray(3))[0].toString(), "gamma");
    ok("Framing : collage + fragmentation gérés");

    const evil = Buffer.alloc(4); evil.writeUInt32BE(SESSION_MAX_FRAME + 1, 0);
    assert.throws(() => new FrameDecoder().push(evil), /trop grande/);
    ok("Framing : taille abusive rejetée");
  }

  // --- 2. Session E2E chiffrée (écho) ---
  await sessionEcho();
  ok("Session E2E : handshake établi, échange chiffré bidirectionnel");

  // --- 3. Handshake invalide refusé ---
  await handshakeFailure();
  ok("Session : handshake invalide refusé (socket fermée)");

  // --- 4. Rekey E2E ---
  await rekeyRoundtrip();
  ok("Rekey : clés renouvelées, trafic déchiffré après rekey");

  // --- 5. Fermeture propre (CLOSE) ---
  await gracefulClose();
  ok("Fermeture propre : le pair reçoit la notification CLOSE");

  // --- 6. Défenses serveur sécurisé : strike → ban + attack log + reconnexion refusée ---
  await serverDefenses();
  ok("Serveur sécurisé : IP bannie après infractions, reconnexion refusée, log écrit");

  // --- 7. PeerManager : ouverture de session vers un pair découvert ---
  await peerManagerDial();
  ok("PeerManager : session ouverte vers un pair annoncé (dédup)");

  // --- 8. Anti-rejeu intra-session ---
  await sessionAntiReplay();
  ok("Anti-rejeu intra-session : séquence dupliquée rejetée");

  // --- 9. Rate limit intra-session ---
  await sessionRateLimit();
  ok("Rate limit intra-session : trop de messages → session fermée");

  // --- 10. Rekey automatique (volume) ---
  await autoRekey();
  ok("Rekey automatique : déclenché au seuil de messages");

  console.log("\n🎉 Tous les tests Sprint 3 sont PASSÉS (" + passed + ") !");
}

function sessionEcho() {
  return new Promise((resolve, reject) => {
    const server = startSecureServer(0, (conn) => {
      let peerOk = false;
      conn.on("secure", (pid) => { peerOk = pid && pid.length === 32; });
      conn.on("message", (m) => {
        assert.ok(peerOk, "pair authentifié côté serveur");
        conn.send(Buffer.concat([Buffer.from("echo:"), m]));
      });
    });
    server.on("listening", () => {
      const { port } = server.address();
      const timer = setTimeout(() => finish(new Error("timeout echo")), 4000);
      const client = connectSecure(port, "127.0.0.1", (conn) => conn.send(Buffer.from("ping")));
      client.on("secure", (pid) => assert.ok(pid.length === 32, "pair authentifié côté client"));
      client.on("message", (m) => {
        clearTimeout(timer);
        try { assert.strictEqual(m.toString(), "echo:ping"); finish(); } catch (e) { finish(e); }
      });
      client.on("error", finish);
      function finish(err) { try { client.close(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function handshakeFailure() {
  return new Promise((resolve, reject) => {
    const server = startSecureServer(0, () => {});
    server.on("listening", () => {
      const { port } = server.address();
      const raw = net.connect(port, "127.0.0.1", () => raw.write(encodeFrame(Buffer.alloc(128, 0x00))));
      const timer = setTimeout(() => finish(new Error("handshake bidon non refusé")), 3000);
      raw.on("close", () => finish());
      raw.on("error", () => finish());
      function finish(err) { clearTimeout(timer); try { raw.destroy(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function rekeyRoundtrip() {
  return new Promise((resolve, reject) => {
    const server = startSecureServer(0, (conn) => {
      conn.on("message", (m) => conn.send(Buffer.concat([Buffer.from("echo:"), m])));
    });
    server.on("listening", () => {
      const { port } = server.address();
      const timer = setTimeout(() => finish(new Error("timeout rekey")), 5000);
      let txBefore = null;
      const client = connectSecure(port, "127.0.0.1", (conn) => conn.send(Buffer.from("before")));

      client.on("message", (m) => {
        const s = m.toString();
        if (s === "echo:before") {
          txBefore = Buffer.from(client.session.txKey);
          client.rekey();               // déclenche le renouvellement
        } else if (s === "echo:after") {
          try {
            assert.ok(!client.session.txKey.equals(txBefore), "clé d'émission renouvelée");
            finish();
          } catch (e) { finish(e); }
        }
      });
      client.on("rekey", () => client.send(Buffer.from("after"))); // après ACK
      client.on("error", finish);
      function finish(err) { clearTimeout(timer); try { client.close(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function gracefulClose() {
  return new Promise((resolve, reject) => {
    let sawPeerClose = false;
    const server = startSecureServer(0, (conn) => {
      conn.on("peerclose", () => { sawPeerClose = true; });
    });
    server.on("listening", () => {
      const { port } = server.address();
      const timer = setTimeout(() => finish(new Error("timeout close")), 4000);
      const client = connectSecure(port, "127.0.0.1", (conn) => setTimeout(() => conn.close(), 50));
      // On laisse le temps au CLOSE d'arriver puis on vérifie.
      setTimeout(() => { clearTimeout(timer); try { assert.ok(sawPeerClose, "peerclose reçu"); finish(); } catch (e) { finish(e); } }, 400);
      client.on("error", () => {});
      function finish(err) { server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function serverDefenses() {
  return new Promise((resolve, reject) => {
    const blacklist = new IpBlacklist({ banMs: 60000, strikeThreshold: 1, strikeWindowMs: 60000 });
    const server = startSecureServer(0, () => {}, { blacklist });
    server.on("listening", () => {
      const { port } = server.address();
      // 1 handshake bidon → 1 strike → ban (seuil 1).
      const raw = net.connect(port, "127.0.0.1", () => raw.write(encodeFrame(Buffer.alloc(128, 0x00))));
      raw.on("close", afterBan);
      raw.on("error", afterBan);
      let done = false;
      function afterBan() {
        if (done) return; done = true;
        setTimeout(() => {
          try {
            assert.ok(blacklist.bannedCount() >= 1, "IP bannie après infraction");
            const log = fs.readFileSync(process.env.ATTACK_LOG_FILE, "utf8");
            assert.ok(/crypto_error|banned/.test(log), "attack log écrit");
          } catch (e) { return finish(e); }
          // Reconnexion : doit être fermée immédiatement.
          const r2 = net.connect(port, "127.0.0.1");
          const t = setTimeout(() => finish(new Error("reconnexion non refusée")), 2000);
          r2.on("close", () => { clearTimeout(t); finish(); });
          r2.on("error", () => { clearTimeout(t); finish(); });
        }, 50);
      }
      function finish(err) { server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function peerManagerDial() {
  return new Promise((resolve, reject) => {
    const server = startSecureServer(0, (conn) => {
      conn.on("message", (m) => conn.send(Buffer.concat([Buffer.from("srv:"), m])));
    });
    server.on("listening", () => {
      const { port } = server.address();
      // Discovery injectée : un pair (nodeId distinct du nôtre) pointant sur le serveur.
      const fakePeer = { nodeId: "ab".repeat(32), address: "127.0.0.1", securePort: port };
      const discovery = { getPeers: () => [fakePeer] };

      const manager = new PeerManager({
        selfId: getPublicKey(),
        discovery,
        intervalMs: 40,
        onSession: (conn) => conn.send(Buffer.from("hi")),
      }).start();

      const timer = setTimeout(() => finish(new Error("timeout peer dial")), 4000);
      const poll = setInterval(() => {
        if (manager.activeCount() === 1) {
          clearInterval(poll);
          // Laisse quelques ticks pour prouver la déduplication (pas de 2e dial).
          setTimeout(() => {
            clearTimeout(timer);
            try { assert.strictEqual(manager.activeCount(), 1, "une seule session (dédup)"); finish(); }
            catch (e) { finish(e); }
          }, 150);
        }
      }, 30);

      function finish(err) { clearInterval(poll); try { manager.stop(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}


function sessionAntiReplay() {
  return new Promise((resolve, reject) => {
    let serverConn = null;
    let sawError = false;
    const server = startSecureServer(0, (conn) => {
      serverConn = conn;
      conn.on("error", () => { sawError = true; });
      conn.on("message", () => {});
    });
    server.on("listening", () => {
      const { port } = server.address();
      const timer = setTimeout(() => finish(new Error("timeout anti-replay")), 4000);
      const client = connectSecure(port, "127.0.0.1", () => {
        // Fabrique une frame DATA seq=1 puis l'injecte deux fois côté serveur.
        const seq = Buffer.alloc(8); seq.writeBigUInt64BE(1n, 0);
        const sealed = client.session.seal(Buffer.concat([Buffer.from([0x00]), seq, Buffer.from("dup")]));
        const frame = encodeFrame(sealed);
        serverConn._onData(frame); // 1er : accepté
        serverConn._onData(frame); // 2e : rejeu -> error
        setTimeout(() => {
          clearTimeout(timer);
          try { assert.ok(sawError, "rejeu applicatif détecté"); finish(); } catch (e) { finish(e); }
        }, 150);
      });
      client.on("error", () => {});
      function finish(err) { try { client.close(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function sessionRateLimit() {
  return new Promise((resolve, reject) => {
    let sawError = false;
    const server = net.createServer((socket) => {
      const conn = new SecureConnection(socket, { initiator: false, maxMsgPerSecond: 5 });
      conn.on("error", () => { sawError = true; });
      conn.on("message", () => {});
    });
    server.listen(0, () => {
      const { port } = server.address();
      const timer = setTimeout(() => finish(new Error("timeout rate limit session")), 4000);
      const client = connectSecure(port, "127.0.0.1", () => {
        for (let i = 0; i < 8; i++) client.send(Buffer.from("m" + i)); // > 5/s
        setTimeout(() => {
          clearTimeout(timer);
          try { assert.ok(sawError, "rate limit session déclenché"); finish(); } catch (e) { finish(e); }
        }, 200);
      });
      client.on("error", () => {});
      function finish(err) { try { client.close(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

function autoRekey() {
  return new Promise((resolve, reject) => {
    const server = startSecureServer(0, (conn) => { conn.on("message", () => {}); });
    server.on("listening", () => {
      const { port } = server.address();
      const timer = setTimeout(() => finish(new Error("timeout auto-rekey")), 4000);
      const socket = net.connect(port, "127.0.0.1");
      const client = new SecureConnection(socket, { initiator: true, rekeyPolicy: { everyMsgs: 3 } });
      client.on("secure", () => {
        client.send(Buffer.from("a"));
        client.send(Buffer.from("b"));
        client.send(Buffer.from("c")); // atteint le seuil -> auto rekey
      });
      client.on("rekey", () => {
        clearTimeout(timer);
        finish();
      });
      client.on("error", finish);
      function finish(err) { try { client.close(); } catch {} server.close(() => err ? reject(err) : resolve()); }
    });
    server.on("error", reject);
  });
}

run()
  .then(() => { cleanup(); process.exit(0); })
  .catch((err) => { cleanup(); console.error("\nÉchec des tests Sprint 3 :", err.message); process.exit(1); });
