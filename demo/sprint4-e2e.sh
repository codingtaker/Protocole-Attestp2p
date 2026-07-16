#!/usr/bin/env bash
# LIVRABLE SPRINT 4 — Démo end-to-end pilotée par la CLI, 2 nœuds réels
# (identités distinctes, sessions chiffrées) : pairs, message chiffré + IA
# (offline gracieux), partage + réception + téléchargement de fichier (SHA-256),
# Web of Trust, statut. Multicast indisponible → bootstrap via --connect.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
A=/tmp/nodeA E2E_B=/tmp/nodeB
rm -rf "$A" "$E2E_B"; mkdir -p "$A" "$E2E_B"
export HMAC_SECRET=archipel-demo
CLI="node bin/archipel.js"

echo "1) Démarrage du nœud A (Alice) — IA désactivée (offline)"
IDENTITY_FILE=$A/identity.key $CLI start --port 7911 --tcp 7910 --control 8911 --data "$A" --no-ai >/tmp/nodeA.log 2>&1 &
APID=$!
sleep 2
AID=$(node -e "console.log(require('$A/runtime.json').nodeId)")
echo "   A node_id = ${AID:0:24}…"

echo "2) Démarrage du nœud B (Bob) + bootstrap vers A (--connect)"
IDENTITY_FILE=$E2E_B/identity.key $CLI start --port 7921 --tcp 7920 --control 8921 --data "$E2E_B" --no-ai --connect 127.0.0.1:7911 >/tmp/nodeB.log 2>&1 &
BPID=$!
sleep 3
BID=$(node -e "console.log(require('$E2E_B/runtime.json').nodeId)")
echo "   B node_id = ${BID:0:24}…"

echo; echo "3) [B] archipel peers"
$CLI peers --data "$E2E_B"

echo; echo "4) [B] archipel msg A \"…/ask…\"  (chat chiffré + déclenchement IA offline)"
$CLI msg "$AID" "@archipel-ai c'est quoi Archipel ?" --data "$E2E_B"

echo; echo "5) [A] archipel send B <fichier 200 Ko>  (partage)"
head -c 200000 /dev/urandom > /tmp/secret.bin
$CLI send "$BID" /tmp/secret.bin --data "$A"
sleep 1

echo; echo "6) [B] archipel receive"
$CLI receive --data "$E2E_B"
FID=$($CLI receive --data "$E2E_B" | head -1 | awk '{print $1}')

echo; echo "7) [B] archipel download <file_id>  (vérif SHA-256)"
$CLI download "$FID" --data "$E2E_B"
echo "   SHA-256 source : $(sha256sum /tmp/secret.bin | awk '{print $1}')"
echo "   SHA-256 reçu   : $(sha256sum "$E2E_B/downloads/secret.bin" 2>/dev/null | awk '{print $1}')"

echo; echo "8) [B] archipel trust A  (Web of Trust)"
$CLI trust "$AID" --data "$E2E_B"

echo; echo "9) [B] archipel status"
$CLI status --data "$E2E_B"

kill -9 $APID $BPID 2>/dev/null
echo; echo "=== Démo E2E terminée ==="
