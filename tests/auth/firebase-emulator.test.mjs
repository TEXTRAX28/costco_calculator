import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { firebaseAdapter } from "../../server/auth/firebase.mjs";

const projectId = "demo-gather-auth";
const host = "127.0.0.1:9199";

test("Firebase emulator runs the production email adapter through registration, verification, sign-in and reset", async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, host);
  const app = initializeApp({ projectId }, "gather-email-emulator-test");
  const origin = "http://" + host;
  const adapter = firebaseAdapter({
    projectId,
    apiKey: "emulator-only-firebase-api-key",
    continueUrl: "http://localhost:4191/auth",
    admin: getAuth(app),
    fetcher(url, options) {
      assert.equal(url.origin, "https://identitytoolkit.googleapis.com");
      return fetch(
        origin + "/identitytoolkit.googleapis.com" + url.pathname + url.search,
        options,
      );
    },
  });
  const email = "emulator-account@example.test";
  const first = "very long example passphrase";
  const second = "another synthetic passphrase";
  async function code(type) {
    const response = await fetch(
      origin + "/emulator/v1/projects/" + projectId + "/oobCodes",
    );
    assert.equal(response.ok, true);
    const records = (await response.json()).oobCodes;
    const item = records.find(
      (entry) => entry.email === email && entry.requestType === type,
    );
    assert.ok(item, "A local email action should exist");
    return item.oobCode;
  }
  const rejects = (name) => (error) => error.code === name;
  try {
    await adapter.register(email, first);
    await adapter.register(email, first);
    await assert.rejects(
      adapter.signIn(email, first),
      rejects("sign_in_failed"),
    );
    const verify = await code("VERIFY_EMAIL");
    assert.equal(await adapter.verificationAccount(verify), email);
    await adapter.verifyEmail(verify);
    await assert.rejects(
      adapter.verificationAccount(verify),
      rejects("expired_link"),
    );
    const signed = await adapter.signIn(email, first);
    assert.equal(signed.issuer, "https://securetoken.google.com/" + projectId);
    assert.equal(signed.email, email);
    await adapter.recover("unknown@example.test");
    await adapter.recover(email);
    const reset = await code("PASSWORD_RESET");
    await assert.rejects(
      adapter.verificationAccount(reset),
      rejects("expired_link"),
    );
    assert.deepEqual(await adapter.recoveryIdentity(reset), {
      issuer: signed.issuer,
      subject: signed.subject,
    });
    await adapter.reset(reset, second);
    await assert.rejects(
      adapter.recoveryIdentity(reset),
      rejects("expired_link"),
    );
    await assert.rejects(
      adapter.signIn(email, first),
      rejects("sign_in_failed"),
    );
    assert.equal((await adapter.signIn(email, second)).subject, signed.subject);
  } finally {
    await deleteApp(app);
  }
});
