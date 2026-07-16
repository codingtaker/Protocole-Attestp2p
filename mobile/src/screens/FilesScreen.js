// Ecran Fichiers : partager un fichier (present sur le PC/noeud) vers un pair,
// et telecharger les fichiers annonces par les pairs (verif SHA-256 cote noeud).
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from "react-native";
import { theme } from "../theme";
import { useNode } from "../NodeContext";

const short = (h) => (h ? h.slice(0, 14) + "..." : "");

export default function FilesScreen() {
  const { files, peers, client, refresh } = useNode();
  const connected = (peers || []).filter((p) => p.connected && !p.self);
  const [peer, setPeer] = useState(null);
  const [filepath, setFilepath] = useState("");
  const [busy, setBusy] = useState("");

  async function share() {
    if (!peer || !filepath.trim()) return Alert.alert("Champs", "Choisissez un pair et un chemin de fichier.");
    setBusy("share");
    try {
      const r = await client.send(peer, filepath.trim());
      Alert.alert(r.error ? "Erreur" : "Partage", r.error || ("file_id " + r.file_id));
      setFilepath("");
      setTimeout(refresh, 600);
    } catch (e) { Alert.alert("Erreur", String(e)); }
    finally { setBusy(""); }
  }

  async function download(fileId) {
    setBusy(fileId);
    try {
      const r = await client.download(fileId);
      Alert.alert(r.error ? "Erreur" : "Telecharge", r.error || (r.filename + " - SHA-256 conforme: " + r.matches));
    } catch (e) { Alert.alert("Erreur", String(e)); }
    finally { setBusy(""); }
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.card}>
        <Text style={styles.h2}>Partager un fichier</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 10 }}>
          {connected.length === 0 ? <Text style={styles.muted}>Aucun pair connecte</Text> :
            connected.map((p) => (
              <TouchableOpacity key={p.nodeId} style={[styles.chip, peer === p.nodeId && styles.chipActive]} onPress={() => setPeer(p.nodeId)}>
                <Text style={[styles.chipText, peer === p.nodeId && styles.chipTextActive]}>{short(p.nodeId)}</Text>
              </TouchableOpacity>
            ))}
        </ScrollView>
        <TextInput
          style={styles.input}
          value={filepath}
          onChangeText={setFilepath}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Chemin du fichier sur le PC (ex C:\\docs\\rapport.pdf)"
          placeholderTextColor={theme.textMuted}
        />
        <TouchableOpacity style={styles.btn} onPress={share} disabled={busy === "share"}>
          <Text style={styles.btnText}>{busy === "share" ? "..." : "Partager"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Fichiers disponibles</Text>
        {(!files || files.length === 0) ? <Text style={styles.muted}>Aucun fichier annonce</Text> :
          files.map((f) => (
            <View key={f.file_id} style={styles.fileRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName}>{f.filename}</Text>
                <Text style={styles.fileMeta}>{f.size} o - {f.nb_chunks} chunks - {short(f.file_id)}</Text>
              </View>
              <TouchableOpacity style={styles.ghost} onPress={() => download(f.file_id)} disabled={busy === f.file_id}>
                <Text style={styles.ghostText}>{busy === f.file_id ? "..." : "Telecharger"}</Text>
              </TouchableOpacity>
            </View>
          ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 14, marginBottom: 14 },
  h2: { color: theme.teal, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: theme.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: theme.blue, borderColor: theme.blue },
  chipText: { color: theme.textMuted, fontFamily: "monospace", fontSize: 12 },
  chipTextActive: { color: "#fff" },
  input: {
    backgroundColor: theme.input, borderWidth: 1, borderColor: theme.line, color: theme.text,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  btn: { backgroundColor: theme.blue, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10 },
  btnText: { color: "#fff", fontWeight: "700" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  fileName: { color: theme.text, fontSize: 14 },
  fileMeta: { color: theme.textMuted, fontSize: 12, marginTop: 2, fontFamily: "monospace" },
  ghost: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  ghostText: { color: "#cfe0ff", fontSize: 12 },
  muted: { color: theme.textMuted, paddingVertical: 8 },
});
