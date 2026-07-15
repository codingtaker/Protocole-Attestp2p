// Journal des tentatives d'attaque. Chaque événement est écrit en JSON (une
// ligne par événement) sur la sortie d'erreur ET dans un fichier append-only
// (logs/attacks.log par défaut, ignoré par git). Sert d'audit et de base à
// d'éventuelles contre-mesures.

const fs = require("fs");
const path = require("path");
const { ATTACK_LOG_FILE } = require("../config");

let dirReady = false;
function ensureDir() {
  if (dirReady) return;
  try {
    fs.mkdirSync(path.dirname(ATTACK_LOG_FILE), { recursive: true });
    dirReady = true;
  } catch {
    /* best-effort : on continue même si le fichier n'est pas accessible */
  }
}

// Journalise un événement d'attaque. `meta` : détails additionnels (optionnel).
function logAttack(type, ip, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    ip: ip || "unknown",
    ...meta,
  };
  const line = JSON.stringify(entry);

  console.warn("🚨 [ATTACK] " + line);

  ensureDir();
  try {
    fs.appendFileSync(ATTACK_LOG_FILE, line + "\n");
  } catch {
    /* best-effort */
  }
  return entry;
}

module.exports = { logAttack, ATTACK_LOG_FILE };
