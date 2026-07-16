// Ecran Statut : cartes de statistiques du noeud.
import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { theme } from "../theme";
import { useNode } from "../NodeContext";

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function StatusScreen() {
  const { status } = useNode();
  if (!status) return <View style={styles.wrap}><Text style={styles.muted}>Chargement...</Text></View>;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.grid}>
        <Stat label="Sessions actives" value={status.sessions} />
        <Stat label="Pairs decouverts" value={status.peersDiscovered} />
        <Stat label="Fichiers locaux" value={status.filesLocal} />
        <Stat label="Fichiers dispo." value={status.filesAvailable} />
        <Stat label="Pairs de confiance" value={status.trusted} />
        <Stat label="Uptime (s)" value={status.uptimeSec} />
      </View>

      <View style={styles.card}>
        <Text style={styles.k}>node_id</Text>
        <Text style={styles.mono} selectable>{status.nodeId}</Text>
        <Text style={styles.info}>
          TCP {status.tcpPort} - secure {status.securePort} - controle {status.controlPort}
        </Text>
        <Text style={styles.info}>IA (Gemini) : {status.aiEnabled ? "activee" : "desactivee"}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  muted: { color: theme.textMuted, padding: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: {
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: 12,
    padding: 14, width: "47.5%",
  },
  statValue: { color: theme.text, fontSize: 24, fontWeight: "700" },
  statLabel: { color: theme.textMuted, fontSize: 12, marginTop: 4 },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 14, marginTop: 14 },
  k: { color: theme.teal, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  mono: { color: theme.text, fontFamily: "monospace", fontSize: 12, marginTop: 6 },
  info: { color: theme.textMuted, fontSize: 13, marginTop: 8 },
});
