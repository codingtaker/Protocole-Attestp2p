// Barre d'onglets du bas. Simple et editable (pas de librairie de navigation).
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { theme } from "../theme";

const TABS = [
  ["status", "Statut"],
  ["peers", "Pairs"],
  ["chat", "Chat"],
  ["files", "Fichiers"],
];

export default function TabBar({ tab, setTab }) {
  return (
    <View style={styles.bar}>
      {TABS.map(([key, label]) => (
        <TouchableOpacity key={key} style={styles.item} onPress={() => setTab(key)}>
          <Text style={[styles.label, tab === key && styles.active]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.line },
  item: { flex: 1, paddingVertical: 14, alignItems: "center" },
  label: { color: theme.textMuted, fontSize: 13 },
  active: { color: theme.blue, fontWeight: "700" },
});
