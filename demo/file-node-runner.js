// Nœud de transfert de fichiers (processus). Rôle et paramètres via l'env :
//   ROLE=seed  : SECURE_PORT, FILE, MANIFEST, STORE_DIR
//   ROLE=leech : SEEDS="host:port,host:port", MANIFEST, OUT, STORE_DIR, PARALLEL
// Chaque processus a sa propre identité (IDENTITY_FILE) → vraie multi-identité.

process.env.HMAC_SECRET = process.env.HMAC_SECRET || "file-demo";
const fs = require("fs");
const { initKeys } = require("../src/crypto/keys");
const { startSecureServer } = require("../src/network/secureServer");
const { connectSecure } = require("../src/network/secureClient");
const { ChunkStore } = require("../src/file/chunkStore");
const { FileNode } = require("../src/file/fileNode");
const { IpRateLimiter } = require("../src/network/ipRateLimiter");

// Sessions de transfert : débit élevé, pas de rekey (gros volume).
const OPT = { maxMsgPerSecond: 1e6, rekeyPolicy: { everyMsgs: 1e9, everyBytes: 1e15, everyMs: 1e9 },
  // Sessions de transfert authentifiees : borne reseau par-IP relevee (bulk).
  ipRateLimiter: new IpRateLimiter(1000000, 1000) };

(async () => {
  await initKeys();
  const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
  const store = new ChunkStore(process.env.STORE_DIR);
  const node = new FileNode({ store, parallel: Number(process.env.PARALLEL || 12) });
  node.on("corrupt", (c) => console.log("CORRUPT " + c.idx));
  node.on("peerclose", () => console.log("PEERCLOSE"));

  if (process.env.ROLE === "seed") {
    node.seed(manifest, process.env.FILE);
    startSecureServer(Number(process.env.SECURE_PORT), (conn) => {
      conn.on("secure", () => node.attachSession(conn));
    }, OPT);
    console.log("SEED_READY " + process.env.SECURE_PORT);
  } else {
    const seeds = (process.env.SEEDS || "").split(",").filter(Boolean);
    for (const hp of seeds) {
      const i = hp.lastIndexOf(":");
      connectSecure(Number(hp.slice(i + 1)), hp.slice(0, i), (conn) => node.attachSession(conn), OPT);
    }
    let last = 0;
    node.on("progress", (pr) => {
      if (pr.received - last >= 10 || pr.received === pr.total) { last = pr.received; console.log("PROGRESS " + pr.received + "/" + pr.total); }
    });
    setTimeout(async () => {
      const t0 = Date.now();
      try {
        const res = await node.download(manifest, process.env.OUT, { parallel: Number(process.env.PARALLEL || 12) });
        console.log("DONE sha=" + res.sha256 + " matches=" + res.matches + " ms=" + (Date.now() - t0));
        process.exit(res.matches ? 0 : 2);
      } catch (e) { console.log("FAIL " + e.message); process.exit(1); }
    }, 1200);
  }
})().catch((e) => { console.log("RUNNER_ERR " + e.stack); process.exit(1); });
