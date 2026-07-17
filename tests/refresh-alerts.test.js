const assert = require("assert"); const { notifyRefreshAlert, sanitizeAlertText } = require("../refresh-alerts");
assert.ok(!sanitizeAlertText("Authorization: Bearer secret-token https://x.test/a?token=secret").includes("secret-token"));
notifyRefreshAlert("test-no-webhook", "failure").then((result) => { assert.equal(result.reason, "not_configured"); console.log("refresh alerts tests passed"); });
