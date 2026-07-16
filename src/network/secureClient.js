// Client de session chiffrée (Sprint 3). Ouvre une connexion TCP et joue le
// rôle d'initiateur du handshake. `onSecure(conn)` est appelé une fois la
// session établie. `options` permet d'ajuster le débit et la politique de rekey
// (utile pour le transfert de fichiers : gros volume, nombreux messages).

const net = require("net");
const { SecureConnection } = require("../session/secureConnection");

function connectSecure(port, host, onSecure, options = {}) {
  if (typeof host === "function") { options = onSecure || {}; onSecure = host; host = undefined; }
  const socket = net.connect(port, host || "127.0.0.1");
  const conn = new SecureConnection(socket, {
    initiator: true,
    maxMsgPerSecond: options.maxMsgPerSecond,
    rekeyPolicy: options.rekeyPolicy,
  });
  // Handler par défaut : évite un 'error' non capté (crash) à la fermeture du pair.
  conn.on("error", () => {});
  if (typeof onSecure === "function") conn.on("secure", () => onSecure(conn));
  return conn;
}

module.exports = { connectSecure };
