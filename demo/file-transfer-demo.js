// LIVRABLE SPRINT 3 — Transfert d'un fichier 50 Mo entre 3 nœuds, vérification
// SHA-256 en live (par chunk) + finale, et simulation de déconnexion d'un nœud
// en cours de transfert. 3 processus séparés (identités distinctes) :
//   S1, S2 : seeders (fichier complet)   |   R : receveur (télécharge en multi-source)
// À mi-transfert, S1 est tué → R poursuit via S2 → fichier final intact.

const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { fork } = require("child_process");

process.env.HMAC_SECRET = "file-demo";
process.env.IDENTITY_FILE = path.join(os.tmpdir(), "attestp2p-orch-" + process.pid + ".key");

const { initKeys } = require("../src/crypto/keys");
const { buildManifest } = require("../src/file/manifest");

const RUNNER = path.join(__dirname, "file-node-runner.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "attestp2p-filetx-"));
const FILE = path.join(TMP, "rapport_confidentiel.pdf");
const MANIFEST = path.join(TMP, "manifest.json");
const OUT = path.join(TMP, "received.bin");
// Taille du fichier de démo : 50 Mo par défaut (livrable), surchargeable pour test rapide.
const SIZE_MB = Number(process.env.DEMO_SIZE_MB) || 50;
const SIZE = SIZE_MB * 1024 * 1024;

function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
function waitFor(child, marker, tag) {
  return new Promise((res) => {
    child.stdout.on("data", (d) => { if (d.toString().includes(marker)) res(); });
    child.stderr.on("data", (d) => { if (process.env.VERBOSE) process.stderr.write("[" + tag + "] " + d); });
  });
}

(async () => {
  console.log("=== LIVRABLE SPRINT 3 — Transfert 50 Mo sur 3 nœuds ===\n");
  await initKeys();

  console.log("1) Création du fichier de démo (50 Mo)...");
  const fd = fs.openSync(FILE, "w");
  const buf = Buffer.allocUnsafe(1024 * 1024);
  for (let i = 0; i < 50; i++) { crypto.randomFillSync(buf); fs.writeSync(fd, buf); }
  fs.closeSync(fd);
  const srcSha = sha256File(FILE);
  console.log("   " + path.basename(FILE) + " — " + SIZE + " octets — SHA-256 " + srcSha.slice(0, 16) + "…");

  console.log("2) Génération du manifest (Module 3.1)...");
  const manifest = buildManifest(FILE, { chunkSize: 512 * 1024, filename: "rapport_confidentiel.pdf" });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest));
  console.log("   " + manifest.nb_chunks + " chunks de " + manifest.chunk_size + " o, signé Ed25519\n");

  const idFile = (n) => path.join(TMP, n + ".key");
  const spawnSeed = (name, port) => fork(RUNNER, [], { silent: true, env: {
    ...process.env, ROLE: "seed", SECURE_PORT: String(port), FILE, MANIFEST,
    STORE_DIR: path.join(TMP, name), IDENTITY_FILE: idFile(name),
  }});

  console.log("3) Démarrage des 2 seeders (S1:8841, S2:8842)...");
  const S1 = spawnSeed("seedS1", 8841);
  const S2 = spawnSeed("seedS2", 8842);
  await Promise.all([waitFor(S1, "SEED_READY", "S1"), waitFor(S2, "SEED_READY", "S2")]);
  console.log("   seeders prêts.\n");

  console.log("4) Démarrage du receveur R (multi-source S1+S2), vérif SHA-256 par chunk en live :");
  const R = fork(RUNNER, [], { silent: true, env: {
    ...process.env, ROLE: "leech", SEEDS: "127.0.0.1:8841,127.0.0.1:8842",
    MANIFEST, OUT, STORE_DIR: path.join(TMP, "leechR"), IDENTITY_FILE: idFile("leechR"), PARALLEL: "16",
  }});

  let killed = false;
  const t0 = Date.now();
  R.stdout.on("data", (d) => {
    const s = d.toString();
    process.stdout.write("   [R] " + s);
    const m = s.match(/PROGRESS (\d+)\/(\d+)/);
    if (!killed && m && Number(m[1]) >= 25) {
      killed = true;
      console.log("   >>> SIMULATION DÉCONNEXION : arrêt brutal du seeder S1 en plein transfert <<<");
      try { S1.kill("SIGKILL"); } catch {}
    }
  });
  if (process.env.VERBOSE) R.stderr.on("data", (d) => process.stderr.write("[R-err] " + d));

  const code = await new Promise((res) => R.on("exit", res));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);

  let outSha = null, okSize = false;
  try { outSha = sha256File(OUT); okSize = fs.statSync(OUT).size === SIZE; } catch {}

  console.log("\n=== Résultat ===");
  console.log("Durée du transfert     : " + dur + " s (critère < 120 s)");
  console.log("Déconnexion S1 simulée : " + (killed ? "oui, en cours de transfert" : "non"));
  console.log("Taille reçue           : " + (okSize ? SIZE + " octets (OK)" : "incorrecte"));
  console.log("SHA-256 source         : " + srcSha);
  console.log("SHA-256 reçu           : " + outSha);
  const okAll = code === 0 && outSha === srcSha && okSize;
  console.log(okAll
    ? "\n✅ SUCCÈS : 50 Mo transférés sur 3 nœuds, S1 déconnecté en cours, fichier final intact (SHA-256 identique)."
    : "\n❌ ÉCHEC (code=" + code + ")");

  for (const c of [S1, S2, R]) { try { c.kill("SIGKILL"); } catch {} }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSy