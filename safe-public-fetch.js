"use strict";
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");

class SafePublicFetchError extends Error {
  constructor(code) { super(code); this.name = "SafePublicFetchError"; this.code = code; }
}

function ipNumber(address, family) {
  if (family === 4) return address.split(".").reduce((n, x) => (n << 8n) | BigInt(x), 0n);
  let text = address;
  if (text.includes(".")) {
    const i = text.lastIndexOf(":"), v4 = ipNumber(text.slice(i + 1), 4);
    text = text.slice(0, i + 1) + (v4 >> 16n).toString(16) + ":" + (v4 & 65535n).toString(16);
  }
  const [left, right] = text.split("::"), a = left ? left.split(":") : [], b = right ? right.split(":") : [];
  const groups = text.includes("::") ? [...a, ...Array(8 - a.length - b.length).fill("0"), ...b] : a;
  return groups.reduce((n, x) => (n << 16n) | BigInt("0x" + x), 0n);
}
const cidrs = (family, entries) => entries.map(([address, prefix]) => ({
  prefix, value: ipNumber(address, family), bits: family === 4 ? 32 : 128,
}));
const V4_DENY = cidrs(4, [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]);
const V6_DENY = cidrs(6, [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["2620:4f:8000::", 48], ["3fff::", 20],
]);
const inRange = (n, r) => (n >> BigInt(r.bits - r.prefix)) === (r.value >> BigInt(r.bits - r.prefix));
function isPublicAddress(address) {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = net.isIP(address);
  if (!family) return false;
  const n = ipNumber(address, family);
  if (family === 4) return !V4_DENY.some(r => inRange(n, r));
  // Only global unicast. This also rejects mapped/compatible IPv4, NAT64, ULA,
  // link/site-local, loopback, unspecified and multicast, without alias bypasses.
  return (n >> 125n) === 1n && !V6_DENY.some(r => inRange(n, r));
}

function parsePublicHttpUrl(input) {
  if (typeof input !== "string" || input.length > 2048 || !/^https?:\/\//i.test(input) || /[\s\\\u0000-\u001f\u007f]/u.test(input)) {
    throw new SafePublicFetchError("unsafe_url");
  }
  let url;
  try { url = new URL(input); } catch { throw new SafePublicFetchError("unsafe_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.port === "0") {
    throw new SafePublicFetchError("unsafe_url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new SafePublicFetchError("unsafe_address");
  } else {
    const labels = host.split(".");
    if (host.length > 253 || labels.length < 2 || labels.some(s => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s)) ||
        /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|home|lan|test|invalid|example|onion)$/.test(host) ||
        /(?:^|\.)home\.arpa$/.test(host)) {
      throw new SafePublicFetchError("unsafe_host");
    }
    url.hostname = host;
  }
  return url;
}

function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(signal.reason || new SafePublicFetchError("aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new SafePublicFetchError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function resolvePublicTarget(input, { lookup = dns.lookup.bind(dns), signal } = {}) {
  const url = parsePublicHttpUrl(input), host = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(host);
  let addresses;
  try {
    addresses = literalFamily ? [{ address: host, family: literalFamily }]
      : await abortable(lookup(host, { all: true, verbatim: true }), signal);
  } catch (error) {
    if (signal && signal.aborted) throw signal.reason || error;
    throw new SafePublicFetchError("dns_failed");
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(r =>
    !r || !isPublicAddress(r.address) || r.family !== net.isIP(r.address))) {
    throw new SafePublicFetchError("unsafe_address");
  }
  return { url, addresses: addresses.map(r => ({ address: r.address, family: r.family })) };
}

function requestPinned(target, options) {
  return new Promise((resolve, reject) => {
    const { url, addresses } = target, maxBytes = options.maxResponseBytes || 262144;
    // A fresh socket uses only the already-validated DNS answers. The original
    // hostname still supplies Host/SNI and normal TLS certificate verification.
    const lookup = (_host, opts, callback) => queueMicrotask(() => {
      if (opts && opts.all) callback(null, addresses.map(r => ({ ...r })));
      else callback(null, addresses[0].address, addresses[0].family);
    });
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: options.method || "GET", headers: options.headers, signal: options.signal,
      lookup, agent: false, maxHeaderSize: 16384,
    }, response => {
      const status = response.statusCode || 502;
      const fail = code => { reject(new SafePublicFetchError(code)); response.destroy(); request.destroy(); };
      if (status >= 300 && status < 400) return fail("redirect_blocked");
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > maxBytes) return fail("response_too_large");
      const chunks = []; let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) fail("response_too_large"); else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new SafePublicFetchError("response_aborted")));
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ ok: status >= 200 && status < 300, status,
          headers: new Headers(Object.entries(response.headers).filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])),
          text: async () => body.toString("utf8") });
      });
    });
    request.on("error", reject);
    request.on("upgrade", (_res, socket) => { socket.destroy(); reject(new SafePublicFetchError("upgrade_blocked")); });
    request.end(options.body);
  });
}

// fetchImpl is a test-only transport seam, never selected by configuration or
// environment. Production always uses the DNS-pinned native HTTP(S) transport.
function createSafePublicFetch({ lookup, fetchImpl } = {}) {
  return async (input, options = {}) => {
    const signal = options.signal || AbortSignal.timeout(45000);
    const target = await resolvePublicTarget(input, { lookup, signal });
    const requestOptions = { ...options, signal, redirect: "error" };
    const response = await abortable(fetchImpl
      ? fetchImpl(target.url.href, requestOptions, target)
      : requestPinned(target, requestOptions), signal);
    if (response && (response.redirected || (response.status >= 300 && response.status < 400))) {
      if (response.body && response.body.cancel) await response.body.cancel().catch(() => {});
      throw new SafePublicFetchError("redirect_blocked");
    }
    return response;
  };
}

module.exports = { SafePublicFetchError, isPublicAddress, parsePublicHttpUrl, resolvePublicTarget, createSafePublicFetch, abortable };
