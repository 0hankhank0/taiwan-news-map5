const assert = require("node:assert/strict");
process.env.EVENT_STORE_MODE = "local";
process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
process.env.AZURE_OPENAI_API_VERSION = "2024-10-21";
process.env.AZURE_OPENAI_API_KEY = "private-key";
process.env.AZURE_OPENAI_DEPLOYMENT = "test";
delete process.env.AZURE_OPENAI_TIMEOUT_MS;
const { createAzureOpenAiChatCompletion } = require("../event-refresh");

(async () => {
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  let timeout;
  AbortSignal.timeout = (ms) => { timeout = ms; return new AbortController().signal; };
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [] }) });
    await createAzureOpenAiChatCompletion({ messages: [] });
    assert.equal(timeout, 15000, "batch requests get a longer default wait budget");
    await createAzureOpenAiChatCompletion({ messages: [] }, 2300);
    assert.equal(timeout, 2300, "the caller's remaining deadline is respected");
    for (const [cause, code] of [
      [Object.assign(new Error("private-key must not leak"), { name: "TimeoutError" }), "AZURE_OPENAI_TIMEOUT"],
      [Object.assign(new TypeError("private endpoint"), { cause: { code: "ENOTFOUND" } }), "AZURE_OPENAI_DNS_ERROR"],
      [Object.assign(new TypeError("private endpoint"), { cause: { code: "ERR_INVALID_URL" } }), "AZURE_OPENAI_INVALID_ENDPOINT"],
      [new TypeError("private transport details"), "AZURE_OPENAI_CONNECTION_ERROR"],
    ]) {
      global.fetch = async () => { throw cause; };
      await assert.rejects(() => createAzureOpenAiChatCompletion({ messages: [] }), (error) => error.code === code && !error.message.includes("private"));
    }
    // fetch resolves at headers; a stalled JSON response must also be diagnosed.
    global.fetch = async () => ({ ok: true, json: async () => { throw Object.assign(new Error("private body"), { name: "AbortError" }); } });
    await assert.rejects(() => createAzureOpenAiChatCompletion({ messages: [] }), (error) => error.code === "AZURE_OPENAI_TIMEOUT");
    global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError("private response"); } });
    await assert.rejects(() => createAzureOpenAiChatCompletion({ messages: [] }), (error) => error.code === "AZURE_OPENAI_INVALID_RESPONSE");
    global.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(() => createAzureOpenAiChatCompletion({ messages: [] }), (error) => error.httpStatus === 403 && error.code === "AZURE_OPENAI_HTTP_ERROR");
  } finally { global.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
  console.log("Azure request diagnostics tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
