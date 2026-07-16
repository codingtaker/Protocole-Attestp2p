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

---

# Démo Sprint 3 — Transfert de fichiers (BitTorrent-like)

Transfert d'un fichier segmenté en chunks (512 Ko), multi-source, avec
vérification SHA-256 par chunk et réassemblage.

## Démo 50 Mo, 3 nœuds, vérification live + déconnexion

```bash
npm run demo:file            # 50 Mo par défaut (in-process, 3 nœuds logiques)
DEMO_SIZE_MB=10 npm run demo:file   # taille réduite
```

Scénario : deux seeders (S1, S2) possèdent le fichier ; un receveur R le
télécharge en multi-source (Rarest First, pipeline parallèle). À ~25 %, S1 est
déconnecté brutalement → R bascule sur S2 et termine. Chaque chunk est vérifié
en SHA-256 à la réception (vérification « live ») et le SHA-256 final est
comparé à la source. Voir `demo/file-transfer-proof.txt` pour une exécution.

## Vrais 3 process (identités distinctes)

```bash
node demo/file-transfer-demo.js      # spawn 3 process : S1, S2 (seeders) + R
```

Identique mais avec 3 processus séparés (chacun sa clé Ed25519), sessions TCP
chiffrées sur `127.0.0.1`. À exécuter sur une machine réelle (nécessite de
pouvoir lancer plusieurs process Node ; peut être trop lourd dans un sandbox).

## Tests automatisés

`npm run test:file` couvre : manifest signé (3.1), chunk store + index (3.4),
transfert complet, multi-source + déconnexion (fallback), chunk corrompu
(détection SHA-256 + re-téléchargement), et 1 source → 2 receveurs.
