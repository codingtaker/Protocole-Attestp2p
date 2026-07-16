// Ecran de connexion : on saisit l'URL de l'API de controle du noeud.
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { theme } from "../theme";
import { createClient } from "../api";

export default function ConnectScreen({ onConnected }) {
  const [url, setUrl] = useState("http://192.168.1.20:8778");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function connect() {
    setBusy(true);
    setError(null);
    const base = url.trim().replace(/\/+$/, "");
    try {
      const s = await createClient(base).status();
      if (s && s.nodeId) onConnected(base);
      else setError("Reponse inattendue du noeud.");
    } catch (e) {
      setError("Connexion impossible. Verifiez l'URL et que le noeud tourne avec --control-host 0.0.0.0.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Image source={require("../../assets/icon.png")} style={styles.logo} />
      <Text style={styles.title}>AttestP2P</Text>
      <Text style={styles.sub}>Connectez-vous a votre noeud</Text>

      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://IP:port"
        placeholderTextColor={theme.textMuted}
      />

      <TouchableOpacity style={styles.btn} onPress={connect} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Se connecter</Text>}
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.hint}>
        Sur le PC, demarrez le noeud avec :{"\n"}
        attestp2p start --control-host 0.0.0.0{"\n\n"}
        L'URL est http://IP-du-PC:8778 (port de controle = securePort + 1000).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: theme.bg },
  logo: { width: 88, height: 88, alignSelf: "center", marginBottom: 12, borderRadius: 20 },
  title: { color: theme.blue, fontSize: 28, fontWeight: "800", textAlign: "center" },
  sub: { color: theme.textMuted, fontSize: 14, textAlign: "center", marginBottom: 24 },
  input: {
    backgroundColor: theme.input, borderWidth: 1, borderColor: theme.line, color: theme.text,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  btn: { backgroundColor: theme.blue, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 14 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: theme.danger, marginTop: 14, textAlign: "center" },
  hint: { color: theme.textMuted, fontSize: 12, marginTop: 28, lineHeight: 18, textAlign: "center" },
});
