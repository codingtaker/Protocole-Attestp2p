// Nœud minimal pour le test multi-nœuds : identité + ports fournis par
// l'environnement, serveur de sessions chiffrées + discovery UDP réelle +
// PeerManager. Émet "PEER_SESSION_OPEN <id>" quand une session s'ouvre.

process.env.HMAC_SECRET = process.env.HMAC_SECRET || "shared-mn";

const { initKeys, getPublicKey } = require("../../src/crypto/keys");
const { startSecureServer } = require("../../src/network/secureServer");
const { startDiscovery } = require("../../src/network/udpDiscovery");
const { PeerManager } = require("../../src/session/peerManager");

(async () => {
  await initKeys();
  const selfId = getPublicKey();

  startSecureServer(Number(process.env.SECURE_TCP_PORT), (conn) => {
    conn.on("secure", () => console.log("INCOMING_SECURE"));
    conn.on("message", (m) => console.log("MSG " + m.toString()));
  });

  const discovery = startDiscovery({
    nodeId: selfId,
    tcpPort: Number(process.env.TCP_PORT || 0),
    securePort: Number(process.env.SECURE_TCP_PORT),
  });

  new PeerManager({
    selfId,
    discovery,
    intervalMs: 500,
    onSession: (conn, peer) => {
      console.log("PEER_SESSION_OPEN " + peer.nodeId.slice(0, 8));
      conn.send(Buffer.from("hi from " + selfId.toString("hex").slice(0, 8)));
    },
  }).start();

  process.on("message", (m) => { if (m === "stop") process.exit(0); });
})().catch((e) => { console.error("RUNNER_ERR " + e.message); process.exit(1); });
