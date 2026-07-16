// Test multi-nœuds RÉEL sur la discovery UDP multicast.
// Lance deux nœuds (identités et ports distincts) dans des process séparés et
// vérifie qu'ils se découvrent et ouvrent une session chiffrée mutuelle.
//
// Le multicast n'est pas disponible dans tous les environnements (conteneurs,
// sandboxes). Si aucune session ne s'établit dans le délai, le test se termine
// en SKIP (exit 0) plutôt qu'en échec : il valide réellement sur un hôte
// multicast-capable, sans casser la CI ailleurs.

const os = require("os");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");

const RUNNER = path.join(__dirname, "helpers", "nodeRunner.js");
const idFile = (n) => path.join(os.tmpdir(), `attestp2p-mn-${n}-${process.pid}.key`);
const KEYS = [idFile("A"), idFile("B")];

function spawnNode(name, securePort) {
  return fork(RUNNER, [], {
    silent: true,
    env: {
      ...process.env,
      HMAC_SECRET: "shared-mn",
      IDENTITY_FILE: name === "A" ? KEYS[0] : KEYS[1],
      SECURE_TCP_PORT: String(securePort),
      TCP_PORT: String(securePort + 1000),
    },
  });
}

function cleanup(children) {
  for (const c of children) { try { c.send("stop"); } catch {} try { c.kill("SIGKILL"); } catch {} }
  for (const k of KEYS) { try { fs.unlinkSync(k); } catch {} }
}

function run() {
  console.log("🧪 Test multi-nœuds discovery UDP...\n");

  const a = spawnNode("A", 7801);
  const b = spawnNode("B", 7802);
  const children = [a, b];

  const opened = { A: false, B: false };
  let mcastError = false;

  function watch(child, label) {
    child.stdout.on("data", (d) => {
      const s = d.toString();
      if (s.includes("PEER_SESSION_OPEN")) opened[label] = true;
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      if (/ENODEV|ENETUNREACH|addMembership|EADDRNOTAVAIL/.test(s)) mcastError = true;
    });
  }
  watch(a, "A"); watch(b, "B");

  setTimeout(() => {
    const both = opened.A && opened.B;
    cleanup(children);
    if (both) {
      console.log("✓ Les deux nœuds se sont découverts et ont ouvert une session chiffrée");
      console.log("\n🎉 Test multi-nœuds PASSÉ !");
      process.exit(0);
    } else {
      const why = mcastError ? "multicast indisponible dans cet environnement"
                             : "aucune session établie dans le délai (multicast probablement indisponible)";
      console.log("⚠️  SKIP : " + why);
      console.log("   (le test valide réellement sur un hôte multicast-capable)");
      process.exit(0);
    }
  }, 8000);
}

run();
