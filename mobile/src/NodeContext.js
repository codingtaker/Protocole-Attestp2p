// Contexte React qui detient le client API et rafraichit periodiquement
// l'etat du noeud (statut, pairs, fichiers). Les ecrans le consomment via
// le hook useNode().

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "./api";

const NodeContext = createContext(null);
export function useNode() { return useContext(NodeContext); }

export function NodeProvider({ baseUrl, children }) {
  const client = useRef(createClient(baseUrl)).current;
  const [status, setStatus] = useState(null);
  const [peers, setPeers] = useState([]);
  const [files, setFiles] = useState([]);

  async function refresh() {
    try {
      const [s, p, f] = await Promise.all([client.status(), client.peers(), client.receive()]);
      setStatus(s);
      setPeers(Array.isArray(p) ? p : []);
      setFiles(Array.isArray(f) ? f : []);
    } catch (e) {
      // Noeud momentanement injoignable : on conserve le dernier etat connu.
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <NodeContext.Provider value={{ baseUrl, client, status, peers, files, refresh }}>
      {children}
    </NodeContext.Provider>
  );
}
