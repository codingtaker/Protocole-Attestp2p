// Ecran Pairs : liste des pairs, connexion bootstrap (host:port), approbation.
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert } from "react-native";
import { theme } from "../theme";
import { useNode } from "../NodeContext";

const short = (h) => (h ? h.slice(0, 14) + "..." : "");

export default function PeersScreen({ goChat }) {
  const { peers, client, refresh } = useNode();
  const [hp, setHp] = useState("");

  async function connect() {
    const i = hp.lastIndexOf(":");
    if (i < 0) return Alert.alert("Format", "Utilisez host:port (ex 192.168.1.30:7778)");
    try {
      await client.connect(hp.slice(0, i) || "127.0.0.1", Number(hp.slice(i + 1)));
      setHp("");
      setTimeout(refresh, 800);
    } catch (e) { Alert.alert("Erreur", String(e)); }
  }

  async function trust(nodeId) {
    try { await client.trust(nodeId); refresh(); } catch (e) { Alert.alert("Erreur", String(e)); }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={hp}
          onChangeText={setHp}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="host:securePort (bootstrap)"
          placeholderTextColor={theme.textMuted}
        />
        <TouchableOpacity style={styles.btn} onPress={connect}>
          <Text style={styles.btnText}>Connecter</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={peers}
        keyExtractor={(p) => p.nodeId}
        ListEmptyComponent={<Text style={styles.muted}>Aucun pair</Text>}
        renderItem={({ item }) => (
          <View style={styles.peer}>
            <Text style={styles.mono}>{short(item.nodeId)}</Text>
            {item.self ? <Tag label="moi" /> : null}
            {item.connected ? <Tag label="session" /> : null}
            {item.trusted ? <Tag label="trust" /> : null}
            <View style={{ flex: 1 }} />
            {!item.self && item.connected ? (
              <TouchableOpacity style={styles.ghost} onPress={goChat}><Text style={styles.ghostText}>Chat</Text></TouchableOpacity>
            ) : null}
            {!item.self && !item.trusted ? (
              <TouchableOpacity style={styles.ghost} onPress={() => trust(item.nodeId)}><Text style={styles.ghostText}>Trust</Text></TouchableOpacity>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

function Tag({ label }) {
  return <Text style={styles.tag}>{label}</Text>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  row: { flexDirection: "row", gap: 8, marginBottom: 12 },
  input: {
    flex: 1, backgroundColor: theme.input, borderWidth: 1, borderColor: theme.line, color: theme.text,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  btn: { backgroundColor: theme.blue, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  peer: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  mono: { color: theme.text, fontFamily: "monospace", fontSize: 13 },
  tag: { color: theme.textMuted, fontSize: 10, backgroundColor: theme.card, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  ghost: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  ghostText: { color: "#cfe0ff", fontSize: 12 },
  muted: { color: theme.textMuted, paddingVertical: 16 },
});
