# Démo Sprint 2 — Session chiffrée Alice → Bob

Prouve qu'un message applicatif envoyé par **Alice** à **Bob** ne circule sur le
réseau que sous forme **chiffrée** (handshake X25519 + HKDF, puis
XChaCha20-Poly1305).

## Lancer la démo

```bash
npm start >/dev/null 2>&1   # (optionnel : un vrai nœud)
node demo/alice-bob-demo.js
```

La démo :
1. démarre Bob (serveur de sessions chiffrées) et Alice (client) ;
2. réalise le handshake, puis Alice envoie un message secret ;
3. capture **tous les octets réellement transmis** sur la socket TCP ;
4. vérifie que le clair (`SPRINT2-SECRET-1337`) **n'apparaît pas** sur le fil ;
5. écrit la preuve dans `demo/capture-proof.txt` et la capture dans
   `demo/alice-bob.pcap`.

## Ouvrir la capture dans Wireshark

1. Ouvrir `demo/alice-bob.pcap` (format pcap, lien *Raw IPv4*).
2. Clic droit sur un segment TCP → **Follow ▸ TCP Stream**.
3. Le flux ne contient que des octets chiffrés — aucun texte lisible, en
   particulier le message d'Alice est introuvable.

> La capture est générée à partir des octets exacts échangés (tcpdump nécessite
> des privilèges non disponibles ici) : c'est un vrai fichier pcap, ouvrable tel
> quel dans Wireshark.
