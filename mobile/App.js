// Point d'entree de l'application AttestP2P (React Native / Expo).
//
// Cette application est un PANNEAU DE CONTROLE distant pour un noeud AttestP2P
// qui tourne sur un PC. Elle parle au noeud via son API HTTP de controle
// (demarrer le noeud avec :  attestp2p start --control-host 0.0.0.0).
//
// Tout le code est volontairement simple et lisible : libre a vous de le modifier.

import React, { useState } from "react";
import { SafeAreaView, View, Text, StyleSheet, StatusBar } from "react-native";

import { theme } from "./src/theme";
import { NodeProvider } from "./src/NodeContext";
import TabBar from "./src/components/TabBar";
import ConnectScreen from "./src/screens/ConnectScreen";
import StatusScreen from "./src/screens/StatusScreen";
import PeersScreen from "./src/screens/PeersScreen";
import ChatScreen from "./src/screens/ChatScreen";
import FilesScreen from "./src/screens/FilesScreen";

export default function App() {
  // URL de base du noeud (ex : http://192.168.1.20:8778). Vide = ecran de connexion.
  const [baseUrl, setBaseUrl] = useState(null);
  const [tab, setTab] = useState("status");

  if (!baseUrl) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" />
        <ConnectScreen onConnected={setBaseUrl} />
      </SafeAreaView>
    );
  }

  return (
    <NodeProvider baseUrl={baseUrl}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" />
        <Header baseUrl={baseUrl} onDisconnect={() => setBaseUrl(null)} />
        <View style={styles.body}>
          {tab === "status" && <StatusScreen />}
          {tab === "peers" && <PeersScreen goChat={() => setTab("chat")} />}
          {tab === "chat" && <ChatScreen />}
          {tab === "files" && <FilesScreen />}
        </View>
        <TabBar tab={tab} setTab={setTab} />
      </SafeAreaView>
    </NodeProvider>
  );
}

function Header({ baseUrl, onDisconnect }) {
  return (
    <View style={styles.header}>
      <Text style={styles.brand}>AttestP2P</Text>
      <Text style={styles.url} numberOfLines={1}>{baseUrl.replace(/^https?:\/\//, "")}</Text>
      <Text style={styles.disconnect} onPress={onDisconnect}>Deconnexion</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.line,
  },
  brand: { color: theme.blue, fontSize: 18, fontWeight: "700" },
  url: { color: theme.textMuted, fontSize: 12, flex: 1 },
  disconnect: { color: theme.teal, fontSize: 12 },
});
