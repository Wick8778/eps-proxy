// api/eps.js — Vercel Serverless Function
// 用 yahoo-finance2 取得股票分析師 EPS 預估（伺服器端，可繞過 Yahoo crumb 限制）

const yahooFinance = require('yahoo-finance2').default;

// 抑制 Yahoo 問卷通知
yahooFinance.suppressNotices(['yahooSurvey']);

module.exports = async function handler(req, res) {
  // CORS：允許任何前端呼叫
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ticker = (req.query.ticker || '').trim();
  if (!ticker) return res.status(400).json({ error: 'ticker parameter is required' });

  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ['earningsTrend', 'defaultKeyStatistics', 'price', 'financialData'],
      validateResult: false,   // 略過嚴格驗證，避免部分股票因格式問題報錯
    });

    // 整理分析師 EPS 預估：取 0y（本年度）、+1y（明年）、+2y（後年）
    const trend = result.earningsTrend?.trend ?? [];
    const analystEstimates = {};
    for (const t of trend) {
      if (!['0y', '+1y', '+2y'].includes(t.period)) continue;
      const eps = t.earningsEstimate?.avg;
      if (eps == null) continue;
      analystEstimates[t.period] = {
        eps,
        epsLow:    t.earningsEstimate?.low             ?? null,
        epsHigh:   t.earningsEstimate?.high            ?? null,
        analysts:  t.earningsEstimate?.numberOfAnalysts ?? null,
      };
    }

    const data = {
      ticker:            ticker.toUpperCase(),
      name:              result.price?.longName ?? result.price?.shortName ?? ticker,
      currency:          result.price?.currency ?? 'USD',
      price:             result.price?.regularMarketPrice   ?? null,
      ttmEps:            result.defaultKeyStatistics?.trailingEps ?? null,
      forwardEps:        result.defaultKeyStatistics?.forwardEps  ?? null,
      earningsGrowth:    result.financialData?.earningsGrowth     ?? null,  // 1 年預估成長率
      analystEstimates,   // { '0y': {...}, '+1y': {...}, '+2y': {...} }
      source: 'yahoo-finance2',
      ts: Date.now(),
    };

    // 快取 6 小時（Vercel Edge Cache）
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json(data);

  } catch (err) {
    console.error(`[eps] ${ticker}: ${err.message}`);
    return res.status(500).json({ error: err.message, ticker });
  }
};
