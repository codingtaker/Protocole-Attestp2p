// Client de session chiffrée (Sprint 3). Ouvre une connexion TCP et joue le
// rôle d'initiateur du handshake. `onSecure(conn)` est appelé une fois la
// session établie.

const net = require("net");
const { SecureConnection } = require("../session/secureConnection");

function connectSecure(port, host, onSecure) {
  if (typeof host === "function") { onSecure = host; host = undefined; }
  const socket = net.connect(port, host || "127.0.0.1");
  const conn = new SecureConnection(socket, { initiator: true });
  if (typeof onSecure === "function") conn.on("secure", () => onSecure(conn));
  return conn;
}

module.exports = { connectSecure };
