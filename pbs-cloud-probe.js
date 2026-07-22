"use strict";

const dns = require("node:dns");
const https = require("node:https");

const PBS_HOST = "rtr.pbs.gov.tw";
const PBS_URL = "https://rtr.pbs.gov.tw/pbsmgt/RoadAllServlet?ajaxAction=roadAllCache";
const DEFAULT_TIMEOUT_MS = 20_000;

function safeError(error) {
  const name = ["AbortError", "Error", "TimeoutError"].includes(error?.name) ? error.name : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code || "")) ? error.code : null;
  return { name, code, message: code ? `HTTPS request failed: ${code}` : `HTTPS request failed: ${name}` };
}

function createIPv4Lookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    return lookup(hostname, { ...(options || {}), family: 4 }, callback);
  };
}

function createIPv4Agent({ lookup = dns.lookup } = {}) {
  return new https.Agent({ lookup: createIPv4Lookup(lookup) });
}

function runHttpsProbe({ requestImpl = https.request, agent, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) {
  return new Promise((resolve) => {
    const started = now();
    let settled = false;
    const result = { ok: false, status: null, elapsedMs: 0, responseBytes: 0, remoteAddress: null, remoteFamily: null, error: null };
    let overallTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (overallTimer) clearTimeout(overallTimer);
      result.elapsedMs = Math.max(0, now() - started);
      result.error = error ? safeError(error) : null;
      resolve(result);
    };
    let request;
    try {
      request = requestImpl(PBS_URL, { method: "GET", agent }, (response) => {
        const socket = response.socket;
        result.status = response.statusCode ?? null;
        result.remoteAddress = socket?.remoteAddress || null;
        result.remoteFamily = socket?.remoteFamily || null;
        response.on("data", (chunk) => { result.responseBytes += Buffer.byteLength(chunk); });
        response.once("error", finish);
        response.once("end", () => {
          result.ok = result.status !== null && result.status >= 200 && result.status < 300;
          finish(null);
        });
        response.resume();
      });
      request.once("error", finish);
      overallTimer = setTimeout(() => {
        const error = new Error("overall request timeout"); error.name = "TimeoutError"; error.code = "ETIMEDOUT";
        request.destroy(error);
      }, timeoutMs);
      request.setTimeout(timeoutMs, () => {
        const error = new Error("request timeout"); error.name = "TimeoutError"; error.code = "ETIMEDOUT";
        request.destroy(error);
      });
      request.end();
    } catch (error) {
      finish(error);
    }
  });
}

async function resolveDns({ resolver = dns.promises, lookup = dns.promises.lookup } = {}) {
  const attempt = async (operation) => { try { return await operation(); } catch { return []; } };
  return {
    resolve4: await attempt(() => resolver.resolve4(PBS_HOST)),
    resolve6: await attempt(() => resolver.resolve6(PBS_HOST)),
    lookupAll: await attempt(() => lookup(PBS_HOST, { all: true })),
  };
}

async function runPbsCloudProbe(options = {}) {
  const dnsResult = await resolveDns(options);
  const probes = {
    default: await runHttpsProbe(options),
    ipv4: await runHttpsProbe({ ...options, agent: options.ipv4Agent || createIPv4Agent({ lookup: options.lookupCallback }) }),
  };
  return {
    runtime: { node: process.version, region: process.env.VERCEL_REGION || null, timestamp: new Date().toISOString() },
    // DNS ordering is recorded only; it does not establish actual connection ordering.
    dns: dnsResult,
    probes,
  };
}

module.exports = { PBS_HOST, PBS_URL, createIPv4Agent, createIPv4Lookup, resolveDns, runHttpsProbe, runPbsCloudProbe, safeError };
