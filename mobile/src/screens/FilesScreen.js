import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { theme } from "../theme";
import { useNode } from "../NodeContext";

const short = (h) => (h ? h.slice(0, 14) + "..." : "");

// Lit un fichier local et renvoie son contenu en base64 (web + natif).
async function readBase64(uri) {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("lecture impossible"));
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.readAsDataURL(blob);
    });
  }
  return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export default function FilesScreen() {
  const { files, peers, client, refresh } = useNode();
  const connected = (peers || []).filter((p) => p.connected && !p.self);
  const [peer, setPeer] = useState(null);
  const [picked, setPicked] = useState(null); // { name, uri }
  const [filepath, setFilepath] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState("");

  async function browse() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled) return;
      const a = res.assets ? res.assets[0] : res;
      setPicked({ name: a.name || "fichier.bin", uri: a.uri });
    } catch (e) { Alert.alert("Erreur", String(e)); }
  }

  async function sharePicked() {
    if (!peer) return Alert.alert("Pair", "Choisissez d'abord un pair connecte.");
    if (!picked) return Alert.alert("Fichier", "Cliquez sur « Parcourir un fichier » pour en choisir un.");
    setBusy("share");
    try {
      const dataBase64 = await readBase64(picked.uri);
      const r = await client.upload(peer, picked.name, dataBase64);
      Alert.alert(r.error ? "Erreur" : "Partage", r.error || (picked.name + "\nfile_id " + short(r.file_id)));
      setPicked(null);
      setTimeout(refresh, 700);
    } catch (e) { Alert.alert("Erreur", String(e)); }
    finally { setBusy(""); }
  }

  async function shareByPath() {
    if (!peer || !filepath.trim()) return Alert.alert("Champs", "Pair + chemin requis.");
    setBusy("path");
    try {
      const r = await client.send(peer, filepath.trim());
      Alert.alert(r.error ? "Erreur" : "Partage", r.error || ("file_id " + short(r.file_id)));
      setFilepath("");
      setTimeout(refresh, 700);
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
          {connected.length === 0 ? <Text style={styles.muted}>Aucun pair connecte</Text> :
            connected.map((p) => (
              <TouchableOpacity key={p.nodeId} style={[styles.chip, peer === p.nodeId && styles.chipActive]} onPress={() => setPeer(p.nodeId)}>
                <Text style={[styles.chipText, peer === p.nodeId && styles.chipTextActive]}>{short(p.nodeId)}</Text>
              </TouchableOpacity>
            ))}
        </ScrollView>

        <TouchableOpacity style={styles.browse} onPress={browse}>
          <Text style={styles.browseText}>Parcourir un fichier...</Text>
        </TouchableOpacity>

        {picked && (
          <View style={styles.pickedRow}>
            <Text style={styles.pickedName} numberOfLines={1}>{picked.name}</Text>
            <TouchableOpacity onPress={() => setPicked(null)}><Text style={styles.clear}>Retirer</Text></TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.btn} onPress={sharePicked} disabled={busy === "share"}>
          <Text style={styles.btnText}>{busy === "share" ? "..." : "Envoyer le fichier choisi"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setAdvanced((v) => !v)}>
          <Text style={styles.advToggle}>{advanced ? "Masquer" : "Option avancee : partager par chemin"}</Text>
        </TouchableOpacity>

        {advanced && (
          <View style={{ marginTop: 8 }}>
            <TextInput
              style={styles.input}
              value={filepath}
              onChangeText={setFilepath}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Chemin sur le PC (ex C:\\docs\\rapport.pdf)"
              placeholderTextColor={theme.textMuted}
            />
            <TouchableOpacity style={styles.btnGhost} onPress={shareByPath} disabled={busy === "path"}>
              <Text style={styles.btnGhostText}>{busy === "path" ? "..." : "Partager ce chemin"}</Text>
            </TouchableOpacity>
          </View>
        )}
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
  browse: { backgroundColor: theme.input, borderWidth: 1, borderColor: theme.blue, borderStyle: "dashed", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  browseText: { color: "#cfe0ff", fontWeight: "700" },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  pickedName: { flex: 1, color: theme.text, fontSize: 13 },
  clear: { color: theme.teal, fontSize: 12 },
  btn: { backgroundColor: theme.blue, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  btnText: { color: "#fff", fontWeight: "700" },
  advToggle: { color: theme.textMuted, fontSize: 12, marginTop: 12, textAlign: "center" },
  input: { backgroundColor: theme.input, borderWidth: 1, borderColor: theme.line, color: theme.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  btnGhost: { borderWidth: 1, borderColor: theme.line, borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 8 },
  btnGhostText: { color: "#cfe0ff", fontWeight: "600" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  fileName: { color: theme.text, fontSize: 14 },
  fileMeta: { color: theme.textMuted, fontSize: 12, marginTop: 2, fontFamily: "monospace" },
  ghost: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  ghostText: { color: "#cfe0ff", fontSize: 12 },
  muted: { color: theme.textMuted, paddingVertical: 8 },
});
