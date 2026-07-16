// Démo Sprint 3 IN-PROCESS : 3 nœuds logiques (S1, S2 seeders + R receveur) reliés
// par de vraies sessions TCP chiffrées (loopback), transfert d'un fichier (50 Mo
// par défaut, DEMO_SIZE_MB pour ajuster), vérification SHA-256 par chunk (live) +
// finale, et simulation de déconnexion d'un seeder en cours de transfert.
//
// Variante autonome pour environnements où lancer 3 process séparés est trop
// lourd. La version "vrais process / identités distinctes" est file-transfer-demo.js.

const os = require("os"), path = require("path"), fs = require("fs"), crypto = require("crypto");
process.env.HMAC_SECRET = "file-demo";
process.env.IDENTITY_FILE = path.join(os.tmpdir(), "attestp2p-inproc-" + process.pid + ".key");

const { initKeys } = require("../src/crypto/keys");
const { startSecureServer } = require("../src/network/secureServer");
const { connectSecure } = require("../src/network/secureClient");
const { ChunkStore, sha256 } = require("../src/file/chunkStore");
const { buildManifest } = require("../src/file/manifest");
const { FileNode } = require("../src/file/fileNode");
const { IpRateLimiter } = require("../src/network/ipRateLimiter");

const OPT = { maxMsgPerSecond: 1e6, rekeyPolicy: { everyMsgs: 1e9, everyBytes: 1e15, everyMs: 1e9 },
  // Sessions de transfert authentifiees : borne reseau par-IP relevee (bulk).
  ipRateLimiter: new IpRateLimiter(1000000, 1000) };
const SIZE_MB = Number(process.env.DEMO_SIZE_MB) || 50;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "attestp2p-inproc-"));
const SRC = path.join(TMP, "rapport_confidentiel.pdf");
const OUT = path.join(TMP, "received.bin");

function link(seedNode, leechNode) {
  return new Promise((resolve) => {
    const server = startSecureServer(0, (conn) => conn.on("secure", () => seedNode.attachSession(conn)), OPT);
    server.on("listening", () => {
      const port = server.address().port;
      const leechConn = connectSecure(port, "127.0.0.1", (conn) => { leechNode.attachSession(conn); resolve({ server, leechConn }); }, OPT);
    });
  });
}

(async () => {
  console.log("=== Démo transfert " + SIZE_MB + " Mo — 3 nœuds (in-process) ===\n");
  await initKeys();

  console.log("1) Création du fichier (" + SIZE_MB + " Mo)...");
  const fd = fs.openSync(SRC, "w"); const buf = Buffer.allocUnsafe(1024 * 1024);
  for (let i = 0; i < SIZE_MB; i++) { crypto.randomFillSync(buf); fs.writeSync(fd, buf); } fs.closeSync(fd);
  const srcSha = sha256(fs.readFileSync(SRC)).toString("hex");
  console.log("   SHA-256 source = " + srcSha.slice(0, 20) + "…");

  console.log("2) Manifest (512 Ko/chunk)...");
  const manifest = buildManifest(SRC, { chunkSize: 512 * 1024, filename: "rapport_confidentiel.pdf" });
  console.log("   " + manifest.nb_chunks + " chunks, signé Ed25519\n");

  const S1 = new FileNode({ store: new ChunkStore(path.join(TMP, "s1")) });
  const S2 = new FileNode({ store: new ChunkStore(path.join(TMP, "s2")) });
  const R  = new FileNode({ store: new ChunkStore(path.join(TMP, "r")), parallel: 16 });
  S1.seed(manifest, SRC); S2.seed(manifest, SRC);
  console.log("3) 2 seeders prêts, ouverture des sessions chiffrées R↔S1, R↔S2...");
  const la = await link(S1, R);
  const lb = await link(S2, R);

  let killed = false, lastPct = -1;
  R.on("progress", (p) => {
    const pct = Math.floor((p.received / p.total) * 100);
    if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; console.log("   [live] " + p.received + "/" + p.total + " chunks vérifiés SHA-256 (" + pct + "%)"); }
    if (!killed && p.received >= Math.floor(p.total / 4)) {
      killed = true;
      console.log("   >>> SIMULATION : déconnexion brutale de S1 en plein transfert <<<");
      la.leechConn.socket.destroy();
    }
  });
  R.on("peerclose", () => console.log("   [R] un pair s'est déconnecté — bascule sur l'autre source"));

  console.log("4) Téléchargement multi-source (Rarest First, pipeline parallèle)...");
  const t0 = Date.now();
  const res = await R.download(manifest, OUT, { parallel: 16 });
  const dur = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n=== Résultat ===");
  console.log("Durée              : " + dur + " s");
  console.log("Déconnexion S1     : simulée en cours de transfert");
  console.log("SHA-256 source     : " + srcSha);
  console.log("SHA-256 reçu       : " + res.sha256);
  const ok = res.matches && res.sha256 === srcSha;
  console.log(ok ? "\n✅ SUCCÈS : fichier transféré via multi-source malgré la déconnexion, SHA-256 identique."
                 : "\n❌ ÉCHEC");
  la.server.close(); lb.server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(process.env.IDENTITY_FILE); } catch {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("Erreur:", e.stack); process.exit(1); });
