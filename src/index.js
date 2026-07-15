
const { initKeys, getPublicKey } = require("./crypto/keys");
const { startTCPServer } = require("./network/tcpServer");
const { startSecureServer } = require("./network/secureServer");
const { startDiscovery } = require("./network/udpDiscovery");
const { PeerManager } = require("./session/peerManager");
const { TCP_PORT, SECURE_TCP_PORT } = require("./config");


async function main() {
  await initKeys();
  const selfId = getPublicKey();

  // Protocole de paquets Sprint 0-2 (compat) + serveur de sessions chiffrées S3.
  startTCPServer(TCP_PORT);

  startSecureServer(SECURE_TCP_PORT, (conn) => {
    conn.on("secure", (peerId) => {
      console.log("🤝 Session chiffrée entrante:", peerId.toString("hex").slice(0, 8) + "…");
    });
    conn.on("message", (m) => {
      console.log("📨 Message chiffré reçu (" + m.length + " octets)");
    });
  });

  // Discovery + ouverture automatique de sessions vers les pairs annoncés.
  const discovery = startDiscovery({
    nodeId: selfId,
    tcpPort: TCP_PORT,
    securePort: SECURE_TCP_PORT,
  });

  const peers = new PeerManager({
    selfId,
    discovery,
    onSession: (conn, peer) => {
      console.log("🔗 Session ouverte vers", peer.nodeId.slice(0, 8) + "…", "@", peer.address);
      conn.send(Buffer.from("hello from " + selfId.toString("hex").slice(0, 8)));
    },
  }).start();

  setInterval(() => {
    console.log("🌐 Sessions actives:", peers.activeCount());
  }, 10000).unref();
}

main().catch((err) => {
  console.error("Échec du démarrage:", err.message);
  process.exit(1);
});
