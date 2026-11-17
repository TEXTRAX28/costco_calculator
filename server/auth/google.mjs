import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  customFetch,
  discovery,
  enableNonRepudiationChecks,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from "openid-client";
import { AuthError } from "./errors.mjs";
import { identitySchema } from "./identity.mjs";

const issuer = "https://accounts.google.com";

export function googleProvider({ clientId, clientSecret, callback }, fetcher) {
  let configuration;
  const connect = () => {
    configuration ??= discovery(
      new URL(issuer),
      clientId,
      { client_secret: clientSecret },
      ClientSecretPost(clientSecret),
      {
        timeout: 8,
        execute: [enableNonRepudiationChecks],
        ...(fetcher ? { [customFetch]: fetcher } : {}),
      },
    ).catch(() => {
      configuration = undefined;
      throw new AuthError("unavailable");
    });
    return configuration;
  };

  return {
    async start() {
      const config = await connect();
      const attempt = {
        state: randomState(),
        nonce: randomNonce(),
        verifier: randomPKCECodeVerifier(),
      };
      const url = buildAuthorizationUrl(config, {
        redirect_uri: callback,
        scope: "openid email",
        code_challenge: await calculatePKCECodeChallenge(attempt.verifier),
        code_challenge_method: "S256",
        state: attempt.state,
        nonce: attempt.nonce,
        prompt: "select_account",
      });
      return { ...attempt, url: url.href };
    },

    async finish(search, attempt) {
      const url = new URL(callback);
      url.search = search;
      if (
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== attempt.state
      )
        throw new AuthError("external_failed");
      if (url.searchParams.get("error") === "access_denied")
        throw new AuthError("external_cancelled");
      const config = await connect();
      try {
        const tokens = await authorizationCodeGrant(config, url, {
          pkceCodeVerifier: attempt.verifier,
          expectedState: attempt.state,
          expectedNonce: attempt.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (claims?.iss !== issuer || claims.email_verified !== true)
          throw new AuthError("external_failed");
        return identitySchema.parse({
          issuer: claims.iss,
          subject: claims.sub,
          email: claims.email,
          authenticatedAt: claims.iat * 1000,
        });
      } catch (error) {
        if (
          [
            "OAUTH_TIMEOUT",
            "OAUTH_RESPONSE_IS_NOT_CONFORM",
            "OAUTH_REQUEST_FAILED",
          ].includes(error?.code) ||
          (error instanceof TypeError && error.cause)
        )
          throw new AuthError("unavailable");
        throw new AuthError("external_failed");
      }
    },
  };
}
