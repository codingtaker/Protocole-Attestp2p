// Tests Sprint 3 — Transfert de fichiers (BitTorrent-like) sur sessions chiffrées.
// Fichier réduit pour un test rapide et déterministe : 2 Mo / chunks 64 Ko.
// (nœuds in-process : identité partagée ; les sessions sont clés de façon unique,
//  ce qui permet de simuler plusieurs pairs.)

const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const assert = require("assert");

process.env.HMAC_SECRET = "attestp2p-secret-temp";
process.env.IDENTITY_FILE = path.join(os.tmpdir(), "attestp2p-s3f-" + process.pid + ".key");

const { initKeys, sign } = require("../src/crypto/keys");
const { startSecureServer } = require("../src/network/secureServer");
const { connectSecure } = require("../src/network/secureClient");
const { ChunkStore, sha256 } = require("../src/file/chunkStore");
const { buildManifest, verifyManifest } = require("../src/file/manifest");
const { FileNode } = require("../src/file/fileNode");
const P = require("../src/file/protocol");

const FILE_SESSION = { maxMsgPerSecond: 100000, rekeyPolicy: { everyMsgs: 1e9, everyBytes: 1e15, everyMs: 1e9 } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "attestp2p-s3f-"));
const SRC = path.join(TMP, "source.bin");

let passed = 0;
function ok(l) { passed++; console.log("✓ " + l); }
const storeDir = (n) => path.join(TMP, n + "-" + Math.random().toString(36).slice(2));
function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(process.env.IDENTITY_FILE); } catch {}
}

// Lie un seeder et un leecher par une session chiffrée réelle (loopback).
function link(seedNode, leechNode) {
  return new Promise((resolve) => {
    const server = startSecureServer(0, (conn) => {
      conn.on("secure", () => seedNode.attachSession(conn));
    }, FILE_SESSION);
    server.on("listening", () => {
      const port = server.address().port;
      const leechConn = connectSecure(port, "127.0.0.1", (conn) => {
        leechNode.attachSession(conn);
        resolve({ server, leechConn });
      }, FILE_SESSION);
    });
  });
}

function chunkSigMessage(fileIdHex, idx, chunkHashBuf) {
  const b = Buffer.alloc(4); b.writeUInt32BE(idx, 0);
  return Buffer.concat([Buffer.from(fileIdHex, "hex"), b, chunkHashBuf]);
}

async function run() {
  console.log("🧪 Tests Sprint 3 — transfert de fichiers...\n");
  await initKeys();

  // Fichier source 2 Mo, chunks 64 Ko.
  fs.writeFileSync(SRC, crypto.randomBytes(2 * 1024 * 1024));
  const manifest = buildManifest(SRC, { chunkSize: 64 * 1024, filename: "source.bin" });
  const srcSha = sha256(fs.readFileSync(SRC)).toString("hex");

  // --- 1. Manifest ---
  assert.strictEqual(manifest.nb_chunks, 32, "32 chunks");
  assert.strictEqual(manifest.file_id, srcSha, "file_id = sha256 du fichier");
  assert.ok(verifyManifest(manifest), "manifest signé valide");
  const tamperedHash = JSON.parse(JSON.stringify(manifest)); tamperedHash.chunks[0].hash = "00".repeat(32);
  assert.ok(!verifyManifest(tamperedHash), "manifest altéré (hash) rejeté");
  const tamperedSig = JSON.parse(JSON.stringify(manifest)); tamperedSig.signature = "00".repeat(64);
  assert.ok(!verifyManifest(tamperedSig), "manifest altéré (signature) rejeté");
  ok("Manifest 3.1 : construction, file_id, signature Ed25519 vérifiée, altérations rejetées");

  // --- 2. ChunkStore ---
  {
    const st = new ChunkStore(storeDir("store"));
    st.registerManifest(manifest);
    const data0 = fs.readFileSync(SRC).subarray(0, 64 * 1024);
    assert.ok(!st.putChunk(manifest.file_id, 0, data0, "ff".repeat(32)).ok, "hash faux rejeté");
    assert.ok(st.putChunk(manifest.file_id, 0, data0, manifest.chunks[0].hash).ok, "hash correct accepté");
    assert.ok(st.hasChunk(manifest.file_id, 0), "chunk présent");
    const bf = st.bitfield(manifest.file_id);
    assert.deepStrictEqual(ChunkStore.parseBitfield(bf, manifest.nb_chunks), [0], "bitfield cohérent");
    ok("ChunkStore 3.4 : put/vérif hash, index, bitfield");
  }

  // --- 3. Transfert complet 1 seeder -> 1 leecher ---
  {
    const seed = new FileNode({ store: new ChunkStore(storeDir("s")) });
    const leech = new FileNode({ store: new ChunkStore(storeDir("l")) });
    seed.seed(manifest, SRC);
    const { server } = await link(seed, leech);
    const out = path.join(TMP, "out1.bin");
    const res = await leech.download(manifest, out, { parallel: 8 });
    assert.ok(res.matches, "sha256 final == source");
    assert.strictEqual(res.sha256, srcSha, "hash identique à la source");
    server.close();
    ok("Transfert complet : fichier réassemblé, SHA-256 identique à la source");
  }

  // --- 4. Multi-source + déconnexion en cours -> fallback ---
  {
    const seedA = new FileNode({ store: new ChunkStore(storeDir("sA")) });
    const seedB = new FileNode({ store: new ChunkStore(storeDir("sB")) });
    const leech = new FileNode({ store: new ChunkStore(storeDir("lM")) });
    seedA.seed(manifest, SRC); seedB.seed(manifest, SRC);
    const la = await link(seedA, leech);
    const lb = await link(seedB, leech);

    let disconnected = false;
    leech.on("progress", (p) => {
      if (!disconnected && p.received >= 4) { disconnected = true; la.leechConn.socket.destroy(); } // coupe seedA
    });
    const out = path.join(TMP, "out2.bin");
    const res = await leech.download(manifest, out, { parallel: 6 });
    assert.ok(res.matches && res.sha256 === srcSha, "transfert complet malgré déconnexion");
    la.server.close(); lb.server.close();
    ok("Multi-source + déconnexion d'un pair en cours : transfert repris via l'autre, aucune corruption");
  }

  // --- 5. Chunk corrompu simulé -> détection + re-téléchargement ---
  {
    const seedBad = new FileNode({ store: new ChunkStore(storeDir("bad")) });
    const seedGood = new FileNode({ store: new ChunkStore(storeDir("good")) });
    const leech = new FileNode({ store: new ChunkStore(storeDir("lc")) });
    seedBad.seed(manifest, SRC); seedGood.seed(manifest, SRC);

    // seedBad corrompt TOUT chunk servi (signature valide sur le hash annoncé,
    // mais données falsifiées) -> le leecher détecte via SHA-256 attendu.
    seedBad._serveChunk = (session, fileId, idx) => {
      if (!seedBad.store.hasChunk(fileId, idx)) { session.send(P.encAck(idx, P.ACK_NOT_FOUND)); return; }
      const data = Buffer.from(seedBad.store.getChunk(fileId, idx)); data[0] ^= 0xff; // corruption
      const chunkHash = Buffer.from(manifest.chunks[idx].hash, "hex"); // hash "annoncé" (celui du manifest)
      const sig = sign(chunkSigMessage(fileId, idx, chunkHash));
      session.send(P.encChunkData(fileId, idx, chunkHash, sig, data));
    };

    let corruptSeen = 0;
    leech.on("corrupt", () => { corruptSeen++; });
    const la = await link(seedBad, leech);
    const lb = await link(seedGood, leech);
    const out = path.join(TMP, "out3.bin");
    const res = await leech.download(manifest, out, { parallel: 6 });
    assert.ok(corruptSeen >= 1, "au moins une corruption détectée");
    assert.ok(res.matches && res.sha256 === srcSha, "fichier final correct après re-téléchargement");
    la.server.close(); lb.server.close();
    ok("Chunk corrompu simulé : détecté (SHA-256) + re-téléchargé ailleurs, fichier final intact (" + corruptSeen + " détections)");
  }

  // --- 6. 1 source -> 2 receveurs simultanés ---
  {
    const seed = new FileNode({ store: new ChunkStore(storeDir("s1")) });
    const r1 = new FileNode({ store: new ChunkStore(storeDir("r1")) });
    const r2 = new FileNode({ store: new ChunkStore(storeDir("r2")) });
    seed.seed(manifest, SRC);
    const c1 = await link(seed, r1);
    const c2 = await link(seed, r2);
    const [res1, res2] = await Promise.all([
      r1.download(manifest, path.join(TMP, "r1.bin"), { parallel: 6 }),
      r2.download(manifest, path.join(TMP, "r2.bin"), { parallel: 6 }),
    ]);
    assert.ok(res1.matches && res1.sha256 === srcSha, "receveur 1 intact");
    assert.ok(res2.matches && res2.sha256 === srcSha, "receveur 2 intact");
    c1.server.close(); c2.server.close();
    ok("1 source -> 2 receveurs : les 2 fichiers arrivent intacts");
  }

  console.log("\n🎉 Tous les tests transfert Sprint 3 sont PASSÉS (" + passed + ") !");
}

run().then(() => { cleanup(); process.exit(0); })
     .catch((e) => { cleanup(); console.error("\nÉchec tests transfert :", e.message); process.exit(1); });
