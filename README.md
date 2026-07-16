# AttestP2P
**AttestP2P** est un protocole et un prototype de réseau **P2P chiffré de bout en
bout**, en Node.js : découverte de pairs, messagerie chiffrée, transfert de
fichiers façon BitTorrent, le tout authentifié (Ed25519) et confidentiel
(handshake X25519 + HKDF, chiffrement XChaCha20-Poly1305), avec un assistant IA
contextuel optionnel (Gemini) clairement isolé et désactivable.

> Le paquet npm s'appelle `attestp2p`. Le protocole/produit est « AttestP2P ».

## Fonctionnalités

- **Identité** Ed25519 persistée (nodeId stable entre redémarrages).
- **Protocole binaire** authentifié : signature Ed25519 + HMAC-SHA256, anti-replay.
- **Handshake « Noise-like »** X25519 + HKDF, authentification mutuelle,
  forward secrecy, session AEAD XChaCha20-Poly1305 avec rekey.
- **Discovery** UDP multicast + ouverture automatique de sessions vers les pairs.
- **Transfert de fichiers** BitTorrent-like : manifest signé, chunks, Rarest
  First, multi-source, vérification SHA-256, re-téléchargement sur corruption,
  fallback sur déconnexion.
- **Défenses** DoS : rate limit (socket / IP / session), blacklist IP temporaire,
  journal des tentatives d'attaque, anti-replay applicatif.
- **CLI + UI web** locale, **Web of Trust**, **assistant IA** contextuel isolé.

## Architecture

```
                        +-------------------------------------------+
                        |               Noeud AttestP2P              |
   CLI  -- HTTP ----->  +---------------+   +----------------------+ |
   UI web ----------->  | Controle HTTP |   | Assistant IA (Gemini)|-+--> (SEULE
                        |  + UI (4.1)   |   | isole, --no-ai (4.2) | |   sortie
                        +---------------+   +----------------------+ |   externe)
                        |            AttestP2PNode                    |
                        |  chat chiffre . Web of Trust . fichiers    |
                        |  +--------------+   +---------------------+ |
                        |  |  FileNode    |   |  PeerManager        | |
                        |  | (BitTorrent) |   | (discovery->session)| |
                        |  +------+-------+   +----------+----------+ |
                        |         |  sessions chiffrees  |            |
                        |  +------+----------------------+---------+  |
                        |  | SecureConnection (framing + handshake |  |
                        |  | X25519/HKDF + AEAD + rekey + anti-rej)|  |
                        |  +------+----------------------+---------+  |
                        +---------+----------------------+-----------+
                            TCP (net)            UDP multicast (discovery)
                                  |                      |
                         +--------+-------+     +--------+--------+
                         |  Pair distant  |     |  Groupe 239.x   |
                         +----------------+     +-----------------+
```

Couches (de bas en haut) :

1. **Protocole binaire** (`src/protocol/packet.js`) — cadre authentifie
   Ed25519 + HMAC, anti-replay (`message.js` + `replay.js`), defenses DoS
   (`tcpServer.js`, `ipRateLimiter.js`, `ipBlacklist.js`, `attackLog.js`).
2. **Handshake & sessions** (`src/crypto/handshake.js`, `src/session/*`) —
   handshake X25519+HKDF, transport chiffre par frames longueur-prefixees,
   rekey, anti-replay applicatif.
3. **Decouverte & pairs** (`src/network/udpDiscovery.js`, `peerManager.js`).
4. **Transfert de fichiers** (`src/file/*`) — manifest, chunk store, protocole,
   orchestrateur multi-source.
5. **Noeud & interfaces** (`src/node/*`, `bin/attestp2p.js`, `src/ai/gemini.js`).

## Choix techniques

- **Node.js**, zero framework serveur, dependances minimales
  (`libsodium-wrappers`, `dotenv`). Reseau via modules standard `net`/`dgram`/`http`.
- **TCP** pour les echanges fiables (sessions, fichiers) ; **UDP multicast** pour
  la decouverte faible-latence sans etat.
- **Sessions chiffrees** separees du protocole binaire historique (compatibilite
  ascendante) ; multiplexage chat/fichiers sur une meme session.
- **IA isolee** dans un seul fichier (`src/ai/gemini.js`) : unique connexion
  reseau sortante, desactivable, testable offline.

## Primitives cryptographiques & justification

| Primitive | Usage | Pourquoi |
|-----------|-------|----------|
| **Ed25519** (libsodium) | Identite du noeud, signature des paquets, du manifest et de chaque chunk | Signatures rapides, cles courtes (32 o), sures ; authentifie l'emetteur sans secret partage |
| **X25519** (`crypto_scalarmult`) | Echange de cles ephemere du handshake | Diffie-Hellman -> **forward secrecy** (cles ephemeres) |
| **HKDF-SHA256** (`crypto.hkdfSync`) | Derivation des cles de session (directionnelles) et rekey | Derivation standard, separation de domaine par `info`, cles independantes par sens |
| **XChaCha20-Poly1305** (AEAD) | Chiffrement + integrite du trafic de session | AEAD moderne, nonce 24 o aleatoire, rapide en logiciel |
| **HMAC-SHA256** | Integrite de transport du protocole binaire (cle partagee) | Rapide, eprouve ; couche d'integrite independante de la signature |
| **SHA-256** | `file_id`, hash de chunk, verification d'integrite | Standard, resistance aux collisions suffisante pour l'integrite de contenu |

Authentification **mutuelle** du handshake : chaque pair signe en Ed25519 le
transcript des cles ephemeres (schema SIGMA-like) -> protege contre l'homme du
milieu et l'unknown-key-share.

## Installation

Prerequis : **Node.js >= 18** (pour `fetch` global) et npm.

```bash
git clone https://github.com/codingtaker/Protocole-Archipel.git
cd Protocole-Archipel        # (dossier local : "attestp2p")
npm install
cp .env.example .env         # puis editer HMAC_SECRET (ex: openssl rand -hex 32)
npm test                     # doit afficher tous les tests PASSES
```

## Lancement

```bash
# Demarrer un noeud (daemon) + UI web locale
node bin/attestp2p.js start --port 7778 --tcp 7777 --data ./.attestp2p
# UI React : http://127.0.0.1:8778   (controle = securePort + 1000 par defaut)

# Sans multicast (LAN restreint / conteneur) : bootstrap explicite
node bin/attestp2p.js start --port 7778 --connect 192.168.1.20:7900

# Mode offline strict (aucune sortie externe)
node bin/attestp2p.js start --no-ai
```

Commandes CLI (dans un autre terminal, `--data` cible le noeud) :

```bash
attestp2p peers                       # pairs decouverts / connectes
attestp2p status                      # etat du noeud + stats reseau
attestp2p msg <node_id> "Hello!"      # message chiffre (/ask ou @attestp2p-ai -> IA)
attestp2p send <node_id> <fichier>    # partager un fichier
attestp2p receive                     # fichiers disponibles
attestp2p download <file_id>          # telecharger (verif SHA-256)
attestp2p trust <node_id>             # approuver un pair (Web of Trust)
attestp2p connect <host:port>         # bootstrap manuel
attestp2p ask <node_id> "question"    # IA contextuelle
```

## Guide de la demo (cas d'usage reproductibles)

### Cas 1 - Message chiffre (Alice -> Bob) + preuve reseau

```bash
npm run demo:s2
```

Alice envoie un message a Bob (handshake X25519+HKDF puis AEAD). Le clair
**n'apparait pas** sur le fil : capture `demo/alice-bob.pcap` (ouvrable dans
Wireshark, *Follow > TCP Stream* = chiffre) et preuve `demo/capture-proof.txt`.

### Cas 2 - Transfert de fichier 50 Mo, 3 noeuds, deconnexion

```bash
npm run demo:file                    # 50 Mo, in-process (rapide, reproductible)
node demo/file-transfer-demo.js      # variante 3 vrais process (machine reelle)
```

2 seeders + 1 receveur, multi-source Rarest First, **verification SHA-256 par
chunk (live)**, **deconnexion d'un seeder** simulee en cours de transfert ->
bascule sur l'autre -> SHA-256 final identique. Preuve : `demo/file-transfer-proof.txt`.

### Cas 3 - End-to-end CLI (message + fichier + trust + IA)

```bash
npm run demo:e2e
```

> Windows : `demo:e2e` utilise automatiquement **Git Bash** (via `demo/run-e2e.js`).
> Alternative directe : `demo\run-e2e.cmd`, ou depuis PowerShell
> `& 'C:\Program Files\Git\bin\bash.exe' demo/sprint4-e2e.sh`. Ne PAS utiliser le
> `bash` de WSL (docker-desktop) qui n'est pas un shell POSIX complet.

Demarre 2 noeuds (identites distinctes), les connecte, liste les pairs, envoie un
message chiffre + declenche l'IA (fallback offline gracieux), partage puis
telecharge un fichier (SHA-256 conforme), approuve un pair, affiche le statut.
Preuve : `demo/sprint4-e2e-proof.txt`.

## Tests

```bash
npm test               # sprints 0->3 + transfert de fichiers
npm run test:file      # transfert : manifest, store, corruption, fallback, 1->2
npm run test:discovery # multi-noeuds UDP reel (skip propre si multicast indispo)
```

## Assistant IA (Gemini) - isolation & offline

- **Isole** dans `src/ai/gemini.js` : unique appel reseau sortant de tout le projet.
- **Declenchement** : tag `@attestp2p-ai` ou `/ask` dans le chat, ou `attestp2p ask`.
- **Contexte** : les `AI_CONTEXT_MESSAGES` derniers messages du fil sont envoyes.
- **Desactivation** : `--no-ai` -> le module n'est jamais appele.
- **Fallback gracieux** : cle absente, reseau injoignable ou HTTP en erreur ->
  message d'erreur lisible dans le fil, **aucun crash** (teste offline).

## Securite & defenses

Fail-closed sur `HMAC_SECRET` . anti-replay (nonce/timestamp au transport,
sequence monotone en session) . rate limit par socket / par IP / par session .
blacklist IP temporaire (strikes -> ban) . journal JSON des attaques
(`logs/attacks.log`) . protections Slowloris & bornes memoire . rekey (manuel +
automatique par volume/temps).

## Limitations connues & pistes d'amelioration

- **Decouverte multicast** indisponible dans de nombreux conteneurs/sandboxes
  (`ENODEV`) -> utiliser `--connect` (bootstrap). Piste : tracker/DHT ou pairs
  d'amorcage configurables.
- **Identite par processus** (module cles singleton) : un process = un nodeId.
  Les demos in-process partagent l'identite (les vrais scenarios utilisent des
  process/identites distincts).
- **HMAC a cle partagee** pour le protocole binaire historique : convient a un
  essaim de confiance, pas a un reseau ouvert. Les sessions chiffrees (S3+) ne
  dependent pas de ce secret.
- **Manifest en memoire** (lecture complete du fichier pour le hash) : a passer
  en streaming pour de tres gros fichiers ; ajouter la reprise sur disque.
- **Web of Trust** minimal (approbations locales) : pas encore de propagation
  transitive ni de revocation.
- **Sessions de transfert** relevent volontairement les bornes de debit
  (authentifiees, bulk) ; affiner par une politique de QoS.
- **Rekey** initie par une seule extremite ; pas de renouvellement d'identite
  longue duree.
- **UI web** : SPA **React** (React UMD + htm, vendorée localement, sans CDN au
  runtime). Un packaging Vite/build serait un axe d'industrialisation.

## Structure du depot

```
src/
  config.js                 constantes + fail-closed HMAC
  crypto/       keys.js (identite Ed25519) . handshake.js (X25519+HKDF+AEAD)
  protocol/     packet.js . message.js (anti-replay) . replay.js . frame.js
  network/      tcpServer.js . secureServer.js . secureClient.js
                udpDiscovery.js . ipRateLimiter.js . ipBlacklist.js
  session/      secureConnection.js . peerManager.js
  security/     attackLog.js
  file/         manifest.js . chunkStore.js . protocol.js . fileNode.js
  ai/           gemini.js                 (SEULE sortie externe, isolee)
  node/         attestp2pNode.js . controlServer.js . trustStore.js . ui/ (SPA React)
bin/attestp2p.js                CLI
tests/            sprint0..3, sprint3-file, discovery.multinode
demo/             alice-bob (S2) . file-transfer (S3) . sprint4-e2e (S4)
```

## Licence

ISC.
 
## Application mobile (React Native / Expo)

L'ancienne UI web (servie par le noeud) a ete retiree. L'interface est desormais
une **application mobile React Native** (dossier `mobile/`), au **code source
entierement modifiable** (aucune minification). Elle pilote le noeud via son API
HTTP de controle.

Demarrage rapide :

```bash
# 1) sur le PC : exposer l'API de controle au reseau local
attestp2p start --control-host 0.0.0.0

# 2) sur le poste de dev : lancer l'app (Expo Go sur le telephone)
cd mobile
npm install
npx expo start
```

Construire un APK Android : voir `mobile/README.md` (EAS Build ou build local).
