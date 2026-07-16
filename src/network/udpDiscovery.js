// Discovery de pairs via UDP multicast.
// Chaque noeud annonce périodiquement son nodeId + port TCP sur le groupe
// multicast, et écoute les annonces des autres. On maintient une table de pairs
// avec expiration (TTL) : un pair silencieux disparaît de la table.
//
// Note : l'annonce n'est PAS authentifiée (discovery best-effort). L'identité
// réelle d'un pair n'est établie qu'à la connexion TCP, via signature Ed25519.

const dgram = require("dgram");
const {
  MULTICAST_ADDR,
  MULTICAST_PORT,
  NODE_NAME,
  DISCOVERY_INTERVAL_MS,
  PEER_TTL_MS
} = require("../config");

function startDiscovery({ nodeId, tcpPort, name = NODE_NAME } = {}) {
  if (!nodeId) {
    throw new Error("startDiscovery : nodeId requis");
  }

  const selfId = Buffer.isBuffer(nodeId) ? nodeId.toString("hex") : String(nodeId);
  const peers = new Map(); // nodeId -> { address, tcpPort, name, lastSeen }

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  function announce() {
    const msg = Buffer.from(JSON.stringify({
      t: "announce",
      nodeId: selfId,
      tcpPort,
      name
    }));
    socket.send(msg, 0, msg.length, MULTICAST_PORT, MULTICAST_ADDR);
  }

  socket.on("message", (raw, rinfo) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return; // annonce illisible : ignorée
    }
    if (!m || m.t !== "announce" || typeof m.nodeId !== "string") return;
    if (m.nodeId === selfId) return; // ignore ses propres annonces

    peers.set(m.nodeId, {
      address: rinfo.address,
      tcpPort: m.tcpPort,
      name: m.name,
      lastSeen: Date.now()
    });
  });

  socket.on("error", (err) => {
    console.log("⚠️ Erreur socket UDP discovery:", err.message);
  });

  socket.bind(MULTICAST_PORT, () => {
    try {
      socket.addMembership(MULTICAST_ADDR);
    } catch (err) {
      console.log("⚠️ addMembership échoué:", err.message);
    }
    socket.setMulticastLoopback(false);
    console.log("📡 Discovery UDP sur", MULTICAST_ADDR + ":" + MULTICAST_PORT);
    announce();
  });

  // Annonce périodique + purge des pairs expirés.
  const announceTimer = setInterval(announce, DISCOVERY_INTERVAL_MS);
  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, p] of peers) {
      if (now - p.lastSeen > PEER_TTL_MS) peers.delete(id);
    }
  }, DISCOVERY_INTERVAL_MS);

  if (announceTimer.unref) announceTimer.unref();
  if (pruneTimer.unref) pruneTimer.unref();

  function getPeers() {
    return Array.from(peers.entries()).map(([id, p]) => ({ nodeId: id, ...p }));
  }

  function stop() {
    clearInterval(announceTimer);
    clearInterval(pruneTimer);
    try { socket.dropMembership(MULTICAST_ADDR); } catch { /* déjà fermé */ }
    socket.close();
  }

  return { getPeers, stop, announce };
}

module.exports = { startDiscovery };
