'use strict';
// The free monthly allowance: how many requests and bytes testers may pull this month before links pause.
// Sized under the hosting free tiers, so a copy that runs for free stays free. One small file, rewritten at most
// every few seconds. ponytail: one process, one file; if there are ever two instances this undercounts, never charges.
const fs = require('fs');
const path = require('path');

module.exports = function usage(CONFIG) {
  const file = path.join(CONFIG.dataDir, 'usage.json');
  const month = () => new Date().toISOString().slice(0, 7);
  let u = { month: month(), requests: 0, bytes: 0, refused: 0 };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && saved.month === u.month) u = { ...u, ...saved };
  } catch {}
  let timer = null;
  const save = () => {
    timer = null;
    try {
      fs.writeFileSync(file, JSON.stringify(u));
    } catch {}
  };
  const touch = () => {
    if (u.month !== month()) u = { month: month(), requests: 0, bytes: 0, refused: 0 };
    if (!timer) timer = setTimeout(save, 5000).unref();
  };
  const exhausted = () => {
    touch();
    return (
      (CONFIG.maxMonthlyRequests > 0 && u.requests >= CONFIG.maxMonthlyRequests) ||
      (CONFIG.maxMonthlyBytes > 0 && u.bytes >= CONFIG.maxMonthlyBytes)
    );
  };
  // Count one request and every byte written to its response.
  const count = (res) => {
    touch();
    u.requests++;
    const add = (chunk) => {
      if (chunk) u.bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    };
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    res.write = (chunk, ...rest) => (add(chunk), write(chunk, ...rest));
    res.end = (chunk, ...rest) => (add(chunk), end(chunk, ...rest));
  };
  const refused = () => {
    touch();
    u.refused++;
  };
  const MESSAGE =
    'This Vantage has used up its free allowance for the month, so links are paused until the 1st. ' +
    'Nothing has been deleted. If you need it sooner, ask the person who shared it with you.';
  const status = () => ({
    month: u.month,
    requests: u.requests,
    bytes: u.bytes,
    refused: u.refused,
    maxRequests: CONFIG.maxMonthlyRequests,
    maxBytes: CONFIG.maxMonthlyBytes,
    paused: exhausted(),
  });
  return { exhausted, count, refused, status, MESSAGE, flush: save };
};
