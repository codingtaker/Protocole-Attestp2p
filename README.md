# AttestP2P

Protocole binaire **P2P sécurisé** sur TCP. Chaque paquet est authentifié à deux
niveaux : **signature Ed25519** (authenticité de l'émetteur) + **HMAC-SHA256**
(intégrité de transport et clé partagée), avec des garde-fous DoS et une
protection anti-replay.

## Stack

- **Langage** : Node.js (v16+ recommandé)
- **Crypto** : `libsodium-wrappers` (Ed25519), module standard `crypto` (HMAC-SHA256)
- **Config** : `dotenv`
- **Réseau** : TCP (échanges fiables), UDP multicast (discovery)

## Démarrage rapide

1. Copier `.env.example` en `.env` et renseigner `HMAC_SECRET`
   (ex : `openssl rand -hex 32`).
2. `npm install`
3. `npm start` (ou `node src/index.js`)
4. Tests : `npm test` (Sprint 0 + Sprint 1)

> Le noeud **refuse de démarrer** si `HMAC_SECRET` est absent (fail-closed, pas
> de secret en dur). Voir `src/config.js`.

## Format de paquet

```
| MAGIC(4) | type(1) | nodeId(32) | payloadLen(4) | payload(N) | signature(64) | hmac(32) |
   └──────────── HEADER (41 octets) ────────────┘   └ body ┘    └ Ed25519 ┘    └ HMAC ┘
```

- **MAGIC** (0..3) : ASCII `ARCH` (0x41 0x52 0x43 0x48).
- **type** (4) : type de message (1 octet).
- **nodeId** (5..36) : clé publique Ed25519 de l'émetteur (32 octets).
- **payloadLen** (37..40) : longueur du payload, UInt32BE.
- **payload** (41..40+N) : données applicatives (voir enveloppe anti-replay).
- **signature** (41+N..104+N) : Ed25519 détachée sur `MAGIC || type || nodeId || payloadLen || payload` (64 octets).
- **hmac** (105+N..136+N) : HMAC-SHA256 sur **tout ce qui précède**, soit `header || payload || signature` (32 octets).

**Overhead fixe = 137 octets** (41 header + 64 signature + 32 HMAC).
Exemple : pour `payloadLen = 10`, la signature commence à l'offset 51 et le HMAC
à l'offset 51 + 64 = **115**.

### Enveloppe anti-replay (dans le payload)

Le payload applicatif est préfixé d'une enveloppe de 24 octets, couverte par la
signature et le HMAC :

```
| timestamp(8, ms UInt64BE) | nonce(16) | data(N) |
```

Le récepteur rejette un paquet dont le `timestamp` est hors fenêtre
(`REPLAY_WINDOW_MS`, ±30 s par défaut) ou dont le couple `(nodeId, nonce)` a déjà
été vu (cache borné par `REPLAY_CACHE_MAX`).

## Pipeline de réception (serveur TCP)

Pour chaque paquet extrait du flux :

1. **Framing** — `extractPackets` valide le MAGIC de chaque paquet, borne
   `payloadLen`/taille totale, gère fragmentation et paquets collés.
2. **Rate limit par socket** — 50 pkts/s (`MAX_PACKETS_PER_SECOND`).
3. **Rate limit par IP** — quota cumulé sur toutes les connexions d'une même
   adresse (`MAX_PACKETS_PER_SECOND_PER_IP`, 200/s par défaut).
4. **HMAC** — `verifyPacket` (intégrité + clé partagée), `timingSafeEqual`
   protégé par une garde de longueur et un check MAGIC.
5. **Signature Ed25519** — `verifySignature` (authenticité de l'émetteur).
6. **Anti-replay** — vérification timestamp + nonce.

Toute étape en échec ferme la connexion.

## Défenses DoS

- **Payload / packet** : `MAX_PAYLOAD_SIZE` (1 MB), `MAX_PACKET_SIZE` (2 MB)
  validés avant allocation.
- **Buffer cumulatif** : `MAX_BUFFER_SIZE` (5 MB) par socket.
- **Rate limit** : par socket **et** par IP.
- **Slowloris** : `SOCKET_IDLE_TIMEOUT` (10 s), `PARTIAL_PACKET_TIMEOUT` (5 s),
  `MAX_CONNECTION_TIME` (60 s).

## Identité

L'identité (paire Ed25519) est dérivée d'une **seed persistée** dans un fichier
`*.key` (défaut `identity.key`, ignoré par git). Le `nodeId` reste donc **stable**
entre redémarrages — prérequis pour une notion de pair connu / réputation.

## Discovery (UDP multicast)

Chaque noeud annonce périodiquement `nodeId + port TCP` sur le groupe multicast
(`MULTICAST_ADDR:MULTICAST_PORT`) et maintient une table de pairs avec expiration
(TTL). L'annonce n'est pas authentifiée (best-effort) ; l'identité réelle n'est
établie qu'à la connexion TCP via signature.

## Architecture

```
src/
├── index.js                → bootstrap (identité + serveur TCP + discovery)
├── config.js               → constantes + getHmacKey() (fail-closed)
├── crypto/keys.js          → identité Ed25519 persistée (seed)
├── protocol/
│   ├── packet.js           → build/parse/verify + extractPackets
│   ├── message.js          → enveloppe timestamp+nonce (wrap/unwrap)
│   └── replay.js           → ReplayGuard (fenêtre + cache de nonces)
└── network/
    ├── tcpServer.js        → serveur TCP + pipeline de sécurité
    ├── ipRateLimiter.js    → rate limit cumulé par IP
    └── udpDiscovery.js     → discovery multicast
tests/
├── sprint0.test.js         → protocole binaire, HMAC, tamper, framing
└── sprint1.test.js         → identité, anti-replay, rate limit IP, intégration
```

## Sécurité — rappels

- Ne jamais committer `.env`, `*.key`, ni de secret en clair (voir `.gitignore`).
- `HMAC_SECRET` doit être partagé hors dépôt.
- Piste ultérieure : AEAD (XChaCha20-Poly1305) pour la confidentialité en plus
  de l'authenticité.
