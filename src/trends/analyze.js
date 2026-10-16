// Analyse des produits repérés : faut-il les vendre sur Kamwa (Congo-Brazzaville) ?
//  - avec la clé Anthropic de Joseph : l'IA Claude donne un verdict argumenté (intégrer / à surveiller / éviter) ;
//  - sans clé : notation intégrée (ventes, avis, marge possible, prix adapté au marché, poids pour l'avion).
// Dans les deux cas le prix de vente tout compris en FCFA est calculé avec les tarifs « Achat en Europe » de Kamwa.
const { computeQuote, importSettings } = require('../imports');
const { guessCategory, WEIGHT } = require('../scrape');

const MODEL = process.env.TREND_MODEL || 'claude-haiku-5-5';

// Prix de vente estimé (article + avion + douane + commission Kamwa) et poids estimé
function landed(c) {
  const cat = guessCategory(c.title) || c.category || '';
  const weightKg = WEIGHT[cat] || 0.6;
  const q = computeQuote([{ priceEur: c.priceEur || 0, qty: 1 }], weightKg, importSettings());
  return { kamwaCategory: cat || null, weightKg, priceFcfa: q.total, costFcfa: q.cost, marginFcfa: q.total - q.cost };
}

// Notation intégrée (0 à 100) quand l'IA n'est pas branchée
function ruleScore(c, ctx) {
  let score = 40; const why = [];
  if (c.volume >= 5000) { score += 20; why.push(`${c.volume.toLocaleString('fr-FR')} ventes récentes`); } else if (c.volume >= 1000) { score += 12; why.push(`${c.volume.toLocaleString('fr-FR')} ventes récentes`); } else if (c.volume < 100 && c.source !== 'kamwa') { score -= 10; why.push('peu de ventes'); }
  if (c.rating >= 95) { score += 10; why.push(`${c.rating} % d'avis positifs`); } else if (c.rating && c.rating < 88) { score -= 15; why.push(`avis moyens (${c.rating} %)`); }
  const L = c.landed;
  if (L.priceFcfa > 400000) { score -= 15; why.push('prix final élevé pour le marché'); } else if (L.priceFcfa <= 60000) { score += 8; why.push('petit prix, achat facile'); }
  if (L.weightKg > 3) { score -= 15; why.push('lourd : transport en avion coûteux'); }
  if (ctx.demand[c.keyword]) { score += 15; why.push(`recherché ${ctx.demand[c.keyword]} fois sur Kamwa`); }
  if (ctx.existing.some((n) => similar(n, c.title))) { score -= 25; why.push('déjà proche d\'un produit du catalogue'); }
  score = Math.max(0, Math.min(100, score));
  return { score, verdict: score >= 70 ? 'integrate' : score >= 50 ? 'watch' : 'avoid', reason: why.join(' · ') || 'Données insuffisantes', risks: [] , by: 'règles' };
}
const words = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
function similar(a, b) { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n >= 3 || (A.size && n / A.size > 0.6); }

// Analyse par Claude (API Anthropic) : réponse en JSON strict, en français
async function aiReview(cands, ctx, apiKey) {
  const system = `Tu es l'acheteur de Kamwa, boutique en ligne au Congo-Brazzaville (Pointe-Noire, Brazzaville). Clients : classes moyennes, mobile, prix en FCFA, paiement en espèces au point relais. Rayons : ${ctx.categories.join(', ')}.
Pour chaque produit candidat, décide s'il faut l'intégrer au catalogue. Tiens compte : tendance (ventes, avis), prix final en FCFA (déjà calculé : article + avion + douane + commission), pouvoir d'achat local, utilité au Congo (climat, électricité instable, réseau mobile), risques (contrefaçon, batterie interdite en avion, retours, fragilité), doublons avec le catalogue existant, et les recherches des clients Kamwa.
Réponds UNIQUEMENT par un tableau JSON : [{"id": "...", "verdict": "integrate"|"watch"|"avoid", "score": 0-100, "reason": "2 phrases max, en français simple", "risks": ["..."], "suggestedPriceFcfa": nombre ou null}]`;
  const user = JSON.stringify({
    recherches_clients_kamwa: ctx.topSearches,
    catalogue_existant_extrait: ctx.existing.slice(0, 60),
    candidats: cands.map((c) => ({ id: c.id, titre: c.title, source: c.source, prix_eur: c.priceEur, ventes_recentes: c.volume, avis_positifs_pct: c.rating, categorie: c.category, prix_final_fcfa: c.landed.priceFcfa, marge_kamwa_fcfa: c.landed.marginFcfa, poids_estime_kg: c.landed.weightKg })),
  });
  const res = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`IA : ${data?.error?.message || res.status}`);
  const text = (data.content || []).map((b) => b.text || '').join('');
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  const arr = JSON.parse(json);
  const out = {};
  for (const r of arr) {
    if (!r?.id) continue;
    out[r.id] = {
      verdict: ['integrate', 'watch', 'avoid'].includes(r.verdict) ? r.verdict : 'watch',
      score: Math.max(0, Math.min(100, Number(r.score) || 50)), reason: String(r.reason || '').slice(0, 400),
      risks: Array.isArray(r.risks) ? r.risks.map((x) => String(x).slice(0, 120)).slice(0, 5) : [],
      suggestedPriceFcfa: Number(r.suggestedPriceFcfa) > 0 ? Math.round(r.suggestedPriceFcfa / 500) * 500 : null, by: 'IA Claude',
    };
  }
  return out;
}

async function analyze(cands, ctx, apiKey) {
  for (const c of cands) c.landed = landed(c);
  let ai = {};
  let aiError = null;
  if (apiKey && cands.length) {
    try { ai = await aiReview(cands, ctx, apiKey); } catch (err) { aiError = err.message; }
  }
  for (const c of cands) c.review = ai[c.id] || ruleScore(c, ctx);
  return { aiError, usedAi: Boolean(apiKey) && !aiError };
}

module.exports = { analyze, landed, ruleScore, MODEL };
