// api/eps.js — Vercel Serverless Function (no npm dependencies)
const https = require('https');

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let body = '';
      const cookies = res.headers['set-cookie'] || [];
      res.on('data', c => body += c);
      res.on('end', () => resolve({ body, cookies, status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 提取純數字（Yahoo 有時回傳 {raw:x, fmt:"x"} 格式）
function raw(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.raw ?? null;
  return v;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ticker = (req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

  try {
    // Step 1: 取得 cookies
    const init = await get('https://finance.yahoo.com', { 'User-Agent': UA, 'Accept': 'text/html' });
    const cookieStr = init.cookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: 取得 crumb
    const crumbRes = await get('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      'User-Agent': UA, 'Cookie': cookieStr,
    });
    const crumb = crumbRes.body.trim();
    if (!crumb || crumb.startsWith('<')) throw new Error('crumb failed: ' + crumb.slice(0, 80));

    // Step 3: 取得 quoteSummary
    const modules = 'earningsTrend,defaultKeyStatistics,price,financialData';
    const apiUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}` +
                   `?modules=${modules}&crumb=${encodeURIComponent(crumb)}&formatted=false`;
    const apiRes = await get(apiUrl, { 'User-Agent': UA, 'Cookie': cookieStr, 'Accept': 'application/json' });
    if (apiRes.status !== 200) throw new Error(`Yahoo API ${apiRes.status}: ${apiRes.body.slice(0, 200)}`);

    const qr = JSON.parse(apiRes.body)?.quoteSummary?.result?.[0];
    if (!qr) throw new Error('no result');

    const trend = qr.earningsTrend?.trend ?? [];
    const analystEstimates = {};
    for (const t of trend) {
      if (!['0y', '+1y', '+2y'].includes(t.period)) continue;
      const eps = raw(t.earningsEstimate?.avg);
      if (eps == null) continue;
      analystEstimates[t.period] = {
        eps,
        epsLow:   raw(t.earningsEstimate?.low)              ?? null,
        epsHigh:  raw(t.earningsEstimate?.high)             ?? null,
        analysts: raw(t.earningsEstimate?.numberOfAnalysts) ?? null,
      };
    }

    const data = {
      ticker,
      name:           raw(qr.price?.longName) ?? raw(qr.price?.shortName) ?? ticker,
      currency:       raw(qr.price?.currency) ?? 'USD',
      price:          raw(qr.price?.regularMarketPrice) ?? null,
      ttmEps:         raw(qr.defaultKeyStatistics?.trailingEps) ?? null,
      forwardEps:     raw(qr.defaultKeyStatistics?.forwardEps)  ?? null,
      earningsGrowth: raw(qr.financialData?.earningsGrowth)     ?? null,
      analystEstimates,
      source: 'yahoo-direct',
      ts: Date.now(),
    };

    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message, ticker });
  }
};
