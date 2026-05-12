// api/eps.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ticker = (req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'ticker parameter is required' });

  let yahooFinance;
  try {
    yahooFinance = require('yahoo-finance2').default;
    yahooFinance.suppressNotices(['yahooSurvey']);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load yahoo-finance2: ' + e.message });
  }

  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ['earningsTrend', 'defaultKeyStatistics', 'price', 'financialData'],
      validateResult: false,
    });

    const trend = result.earningsTrend?.trend ?? [];
    const analystEstimates = {};
    for (const t of trend) {
      if (!['0y', '+1y', '+2y'].includes(t.period)) continue;
      const eps = t.earningsEstimate?.avg;
      if (eps == null) continue;
      analystEstimates[t.period] = {
        eps,
        epsLow:   t.earningsEstimate?.low              ?? null,
        epsHigh:  t.earningsEstimate?.high             ?? null,
        analysts: t.earningsEstimate?.numberOfAnalysts ?? null,
      };
    }

    const data = {
      ticker,
      name:           result.price?.longName ?? result.price?.shortName ?? ticker,
      currency:       result.price?.currency ?? 'USD',
      price:          result.price?.regularMarketPrice ?? null,
      ttmEps:         result.defaultKeyStatistics?.trailingEps ?? null,
      forwardEps:     result.defaultKeyStatistics?.forwardEps  ?? null,
      earningsGrowth: result.financialData?.earningsGrowth     ?? null,
      analystEstimates,
      source: 'yahoo-finance2',
      ts: Date.now(),
    };

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json(data);

  } catch (err) {
    console.error(`[eps] ${ticker}: ${err.message}`);
    return res.status(500).json({ error: err.message, ticker });
  }
};
