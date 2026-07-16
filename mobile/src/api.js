// Client HTTP de l'API de controle d'un noeud AttestP2P.
// Chaque methode renvoie une promesse resolue avec le JSON du noeud.
// Aucune dependance externe : on utilise fetch (fourni par React Native).

async function request(baseUrl, method, route, body) {
  const res = await fetch(baseUrl + route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function createClient(baseUrl) {
  return {
    status: () => request(baseUrl, "GET", "/status"),
    peers: () => request(baseUrl, "GET", "/peers"),
    receive: () => request(baseUrl, "GET", "/receive"),
    messages: (peer) => request(baseUrl, "GET", "/messages?peer=" + encodeURIComponent(peer)),
    connect: (host, port) => request(baseUrl, "POST", "/connect", { host, port }),
    msg: (nodeId, text) => request(baseUrl, "POST", "/msg", { nodeId, text }),
    send: (nodeId, filepath) => request(baseUrl, "POST", "/send", { nodeId, filepath }),
    download: (file_id) => request(baseUrl, "POST", "/download", { file_id }),
    trust: (nodeId) => request(baseUrl, "POST", "/trust", { nodeId }),
    ask: (nodeId, query) => request(baseUrl, "POST", "/ask", { nodeId, query }),
  };
}
