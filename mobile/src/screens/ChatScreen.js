// Ecran Chat : choix d'un pair connecte, fil de discussion chiffre, envoi.
// Astuce : ecrire /ask ... ou inclure @attestp2p-ai interroge l'assistant IA.
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { theme } from "../theme";
import { useNode } from "../NodeContext";

const short = (h) => (h ? h.slice(0, 12) + "..." : "");

export default function ChatScreen() {
  const { peers, client } = useNode();
  const connected = (peers || []).filter((p) => p.connected && !p.self);
  const [peer, setPeer] = useState(null);
  const [thread, setThread] = useState([]);
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  // Selectionne automatiquement le premier pair connecte.
  useEffect(() => {
    if (!peer && connected.length) setPeer(connected[0].nodeId);
  }, [connected, peer]);

  // Rafraichit le fil du pair selectionne.
  useEffect(() => {
    if (!peer) return;
    let alive = true;
    async function load() {
      try { const t = await client.messages(peer); if (alive) setThread(Array.isArray(t) ? t : []); } catch (e) {}
    }
    load();
    const timer = setInterval(load, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [peer]);

  async function send() {
    if (!peer || !text.trim()) return;
    const value = text;
    setText("");
    try { await client.msg(peer, value); } catch (e) {}
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ gap: 8, padding: 10 }}>
        {connected.length === 0 ? (
          <Text style={styles.muted}>Aucun pair connecte (onglet Pairs)</Text>
        ) : connected.map((p) => (
          <TouchableOpacity
            key={p.nodeId}
            style={[styles.chip, peer === p.nodeId && styles.chipActive]}
            onPress={() => setPeer(p.nodeId)}
          >
            <Text style={[styles.chipText, peer === p.nodeId && styles.chipTextActive]}>{short(p.nodeId)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        onContentSizeChange={() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true })}
      >
        {thread.length === 0 ? (
          <Text style={styles.muted}>Aucun message</Text>
        ) : thread.map((m, i) => (
          <View key={i} style={[styles.msg, styles["msg_" + m.dir]]}>
            <Text style={styles.msgText}>{m.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          editable={!!peer}
          placeholder="Message... (/ask ou @attestp2p-ai pour l'IA)"
          placeholderTextColor={theme.textMuted}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.btn} onPress={send} disabled={!peer}>
          <Text style={styles.btnText}>Envoyer</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  chips: { maxHeight: 56, borderBottomWidth: 1, borderBottomColor: theme.line },
  chip: { borderWidth: 1, borderColor: theme.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: theme.blue, borderColor: theme.blue },
  chipText: { color: theme.textMuted, fontFamily: "monospace", fontSize: 12 },
  chipTextActive: { color: "#fff" },
  thread: { flex: 1 },
  msg: { maxWidth: "82%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  msg_out: { alignSelf: "flex-end", backgroundColor: "#1e3a8a" },
  msg_in: { alignSelf: "flex-start", backgroundColor: "#1b2836" },
  msg_ai: { alignSelf: "flex-start", backgroundColor: "#14352a", borderWidth: 1, borderColor: "#1f6f4d" },
  msgText: { color: theme.text, fontSize: 14 },
  muted: { color: theme.textMuted, padding: 12 },
  inputRow: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: theme.line },
  input: {
    flex: 1, backgroundColor: theme.input, borderWidth: 1, borderColor: theme.line, color: theme.text,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  btn: { backgroundColor: theme.blue, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
