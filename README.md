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

Le projet est compose de **deux paquets** independants :

| Paquet | Role | Ou l'installer |
|---|---|---|
| **Noeud** (`./`) | Coeur du protocole : identite, sessions chiffrees, API de controle HTTP | Sur un **PC** (Windows / Linux / macOS) qui restera actif et joignable |
| **App mobile** (`./mobile`) | Interface graphique React Native / Expo | Sur un **telephone** Android/iOS via Expo Go, en APK, ou en version web |

### 1. Prerequis

- **Node.js >= 18** (fetch global requis) et **npm** : https://nodejs.org
- **git**
- **Expo Go** installe sur le telephone (Play Store Android / App Store iOS) si vous utilisez l'app mobile en mode developpement
- PC et telephone sur le **meme reseau Wi-Fi** (usage LAN standard)

### 2. Installer le noeud (sur le PC)

```bash
git clone https://github.com/codingtaker/Protocole-Archipel.git
cd Protocole-Archipel        # (dossier local : "attestp2p")
npm install
cp .env.example .env
```

Editer `.env` et renseigner au minimum :

```env
HMAC_SECRET=<generer avec: openssl rand -hex 32>
# GEMINI_API_KEY=...   (optionnel, assistant IA ; laisser vide ou lancer --no-ai)
```

Verifier l'installation :

```bash
npm test                    # tous les tests doivent passer
```

### 3. Installer l'application mobile

```bash
cd mobile
npm install
```

Rien d'autre a installer pour un usage en developpement : Expo Go, sur le
telephone, chargera le code au moment du scan du QR code.

## Lancement du noeud

**Cas standard** — le noeud accepte les connexions du telephone sur le LAN :

```bash
# depuis la racine du depot
node bin/attestp2p.js start --control-host 0.0.0.0
# equivalent si installe globalement :
# attestp2p start --control-host 0.0.0.0
```

Sortie attendue :

```
Noeud AttestP2P demarre
   node_id     : <cle publique Ed25519>
   secure/tcp  : 7778 / 7777
   API controle: http://0.0.0.0:8778
   ...
```

**Autres modes** :

```bash
# Acces LOCAL uniquement (defaut) - aucun acces depuis le reseau
attestp2p start

# Bootstrap explicite (LAN sans multicast, conteneur, WSL, VPN)
attestp2p start --control-host 0.0.0.0 --connect 192.168.1.42:7778

# Mode offline strict : aucune sortie externe (IA desactivee)
attestp2p start --no-ai
```

**Trouver l'IP du PC** (a saisir dans l'app mobile) :

```powershell
# Windows PowerShell
ipconfig | Select-String IPv4
```

```bash
# Linux / macOS
hostname -I                       # ou :  ifconfig | grep 'inet '
```

Noter l'adresse IPv4 du LAN (typiquement `192.168.x.x` ou `10.x.x.x`).

> **Firewall Windows** : autoriser Node.js sur le "reseau prive" au premier lancement.
> **Firewall Linux** : ouvrir les ports en LAN, ex. `sudo ufw allow 7777:8778/tcp`.

## Application mobile — installation et connexion

L'interface graphique est une application **React Native / Expo** situee dans
`mobile/`. Elle pilote le noeud via son API HTTP de controle. Trois manieres de
l'utiliser (choisir une seule) :

### Option A — Expo Go (recommande pour tester)

1. Installer **Expo Go** sur le telephone (Play Store / App Store).
2. Sur le PC, dans le dossier `mobile/`, lancer le serveur de developpement :

   ```bash
   cd mobile
   npx expo start
   ```

3. Un QR code s'affiche dans le terminal. **Le scanner** :
   - Android : depuis l'app **Expo Go**, bouton "Scan QR Code"
   - iOS : depuis l'**appareil photo** natif (Expo Go s'ouvre automatiquement)

   L'application se charge sur le telephone.
4. Sur l'ecran de connexion, saisir l'URL de **votre** noeud :

   ```
   http://<IP-du-PC>:8778
   ```

   Exemple : `http://192.168.1.20:8778` (l'IP notee plus haut).
   Le port `8778` = `securePort + 1000` (defaut : secure 7778 -> controle 8778).

5. Appuyer sur **Se connecter**. L'app affiche desormais les onglets
   **Statut / Pairs / Chat / Fichiers**.

**Prerequis** : PC et telephone sur le **meme Wi-Fi**, et le noeud demarre
avec `--control-host 0.0.0.0`. Sinon la connexion est refusee.

### Option B — APK Android (installation permanente)

Pour distribuer l'application sans passer par Expo Go :

```bash
cd mobile
npm install -g eas-cli
eas login                                # compte Expo gratuit
eas build -p android --profile preview   # produit un .apk telechargeable
```

Ou en local (necessite Android SDK) :

```bash
cd mobile
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# APK : android/app/build/outputs/apk/release/app-release.apk
```

Installer l'APK sur le telephone (autoriser "sources inconnues" une fois),
lancer l'app, saisir la meme URL `http://<IP-du-PC>:8778`.

### Option C — Version web (sans telephone)

Utile pour un apercu depuis n'importe quel navigateur :

```bash
cd mobile
npm run web                # dev : http://localhost:8081
# ou export statique deployable (Vercel, Netlify, GitHub Pages, ...) :
npm run export:web         # sortie dans mobile/dist/
```

## Rappel des commandes CLI

Dans un autre terminal, sur le PC ou tourne le noeud (`--data` cible le noeud) :

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

## Utilisation en equipe / deploiement open source

AttestP2P est **auto-heberge** : chaque personne fait tourner **son propre
noeud** sur son PC, et les noeuds s'echangent messages et fichiers directement,
sans serveur central.

### Scenario 1 — plusieurs personnes sur le meme reseau local

1. Chacun clone le depot, `npm install`, cree son `.env` (HMAC_SECRET partage
   dans l'equipe), puis demarre :

   ```bash
   attestp2p start --control-host 0.0.0.0
   ```

2. La **decouverte automatique** via UDP multicast detecte les autres noeuds.
   Verifier dans l'app mobile : onglet **Pairs** liste les nodeId decouverts.
3. Chacun se connecte a son propre noeud depuis son telephone (via Expo Go
   ou APK) en saisissant l'IP de **son** PC.
4. Depuis l'app : discuter (onglet **Chat**), s'echanger des fichiers (onglet
   **Fichiers**), **approuver** un pair (bouton "Trust" dans **Pairs**).

### Scenario 2 — noeuds sur des reseaux differents (Internet)

Le multicast ne traverse pas Internet. Il faut un **bootstrap explicite** :

1. Un noeud doit etre **joignable** depuis l'exterieur : IP publique + port
   TCP `7778` ouvert (redirection sur le routeur), ou tunnel type
   **Tailscale / ZeroTier / ngrok TCP / Cloudflare Tunnel**.
2. Les autres noeuds s'y connectent explicitement :

   ```bash
   attestp2p start --control-host 0.0.0.0 --connect <IP-publique>:7778
   ```

3. Une fois la premiere session ouverte, les pairs se decouvrent en cascade.

### Scenario 3 — noeud distant + app mobile locale

Heberger le noeud sur un serveur (VPS, Raspberry Pi, ...) et le piloter depuis
son telephone :

1. Sur le serveur : `attestp2p start --control-host 0.0.0.0`.
2. Ne pas exposer directement le port `8778` sur Internet (pas d'auth) —
   passer par un **tunnel SSH** ou un **VPN Tailscale**.
3. Depuis le telephone (dans le meme reseau Tailscale/via SSH forward),
   saisir l'URL correspondante dans l'app.

### Notes de securite pour le deploiement

- `--control-host 0.0.0.0` expose l'API de controle **sans authentification** :
  ne l'utiliser **que sur un reseau de confiance**. Sur un hotspot / reseau
  public, garder `127.0.0.1` (defaut) et passer par un tunnel SSH/VPN.
- Le fichier `identity.key` contient la seed Ed25519 (identite du noeud) :
  ne **jamais** le partager, ne pas le committer (deja dans `.gitignore`).
- `HMAC_SECRET` protege le protocole binaire historique : le partager
  uniquement au sein de l'essaim de confiance. Les sessions chiffrees (S3+)
  n'en dependent plus.
- Pour un vrai deploiement multi-utilisateurs, envisager Docker + Tailscale,
  avec un `.env` et une `identity.key` par utilisateur.

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
