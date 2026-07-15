
const { initKeys, getPublicKey } = require("./crypto/keys");
const { startTCPServer } = require("./network/tcpServer");
const { startDiscovery } = require("./network/udpDiscovery");
const { TCP_PORT } = require("./config");


async function main() {
  await initKeys();

  startTCPServer(TCP_PORT);

  const discovery = startDiscovery({
    nodeId: getPublicKey(),
    tcpPort: TCP_PORT
  });

  // Log périodique des pairs découverts.
  setInterval(() => {
    const peers = discovery.getPeers();
    if (peers.length > 0) {
      console.log("🌐 Pairs connus:", peers.map(p => p.nodeId.slice(0, 8) + "…").join(", "));
    }
  }, 10000).unref();
}

main().catch((err) => {
  console.error("Échec du démarrage:", err.message);
  process.exit(1);
});
