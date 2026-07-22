"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createIPv4Agent, createIPv4Lookup, runHttpsProbe, runPbsCloudProbe, safeError } = require("../pbs-cloud-probe");

(async () => {
  let lookupOptions;
  const ipv4Lookup = createIPv4Lookup((host, options, callback) => { lookupOptions = { host, options }; callback(null, "117.56.47.51", 4); });
  await new Promise((resolve, reject) => ipv4Lookup("rtr.pbs.gov.tw", { all: false }, (error, address, family) => error ? reject(error) : (assert.equal(address, "117.56.47.51"), assert.equal(family, 4), resolve())));
  assert.deepEqual(lookupOptions, { host: "rtr.pbs.gov.tw", options: { all: false, family: 4 } });

  let receivedAgent;
  const requestImpl = (_url, options, callback) => {
    receivedAgent = options.agent;
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = (error) => request.emit("error", error);
    request.end = () => process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.socket = { remoteAddress: "117.56.47.51", remoteFamily: "IPv4" };
      response.resume = () => { response.emit("data", Buffer.from("response body must not be returned")); response.emit("end"); };
      callback(response);
    });
    return request;
  };
  const agent = createIPv4Agent({ lookup: (host, options, callback) => ipv4Lookup(host, options, callback) });
  const result = await runHttpsProbe({ requestImpl, agent });
  await new Promise((resolve, reject) => receivedAgent.options.lookup("rtr.pbs.gov.tw", {}, (error, address, family) => error ? reject(error) : (assert.equal(address, "117.56.47.51"), assert.equal(family, 4), resolve())));
  assert.equal(lookupOptions.options.family, 4);
  assert.equal(result.remoteFamily, "IPv4");
  assert.equal(result.responseBytes, 34);
  assert.equal(JSON.stringify(result).includes("response body must not be returned"), false);

  const unsafe = new Error("Authorization: Bearer secret-value body: private payload"); unsafe.code = "ECONNRESET";
  const serialized = safeError(unsafe);
  assert.equal(JSON.stringify(serialized).includes("secret-value"), false);
  assert.equal(JSON.stringify(serialized).includes("private payload"), false);

  const report = await runPbsCloudProbe({
    resolver: { resolve4: async () => ["117.56.47.51"], resolve6: async () => ["2001:4420:a051::21"] },
    lookup: async () => [{ address: "2001:4420:a051::21", family: 6 }, { address: "117.56.47.51", family: 4 }],
    requestImpl,
    ipv4Agent: agent,
  });
  assert.deepEqual(report.dns.lookupAll.map((entry) => entry.family), [6, 4]);
  assert.equal(report.probes.ipv4.remoteFamily, "IPv4");
  console.log("PBS cloud probe tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
