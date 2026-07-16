// Module 4.2 — Intégration Gemini (SEULE connexion externe autorisée).
// Volontairement ISOLÉE dans ce fichier. Aucune autre partie du code ne fait
// d'appel réseau sortant. Désactivable en amont via le flag --no-ai (le nœud
// n'appelle simplement pas ce module). En cas d'échec (offline, clé absente,
// HTTP KO), l'appelant reçoit une erreur et affiche un fallback gracieux.

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-pro";

function buildPrompt(context, query) {
  const history = (context || [])
    .map((m) => (m.dir === "out" ? "Moi" : m.dir === "ai" ? "IA" : "Pair") + ": " + m.text)
    .join("\n");
  return [
    "Tu es l'assistant contextuel d'Archipel, un réseau P2P chiffré et décentralisé.",
    "Réponds de façon concise et utile, en français.",
    history ? "\nContexte récent de la conversation :\n" + history : "",
    "\nQuestion : " + query,
  ].join("\n");
}

async function queryGemini(context, query, opts = {}) {
  const apiKey = opts.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) { const e = new Error("GEMINI_API_KEY absent"); e.code = "NO_KEY"; throw e; }
  if (typeof fetch !== "function") { const e = new Error("fetch indisponible"); e.code = "NO_FETCH"; throw e; }

  const model = opts.model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(context, query) }] }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) { const e = new Error("Gemini HTTP " + res.status); e.code = "HTTP"; throw e; }
    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!text) { const e = new Error("réponse vide"); e.code = "EMPTY"; throw e; }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { queryGemini, buildPrompt, DEFAULT_MODEL };
