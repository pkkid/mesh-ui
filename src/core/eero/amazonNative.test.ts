/**
 * Amazon-native PKCE protocol: URL shape, return validation, token exchange.
 * Never hits api.amazon.com; fetch is injected.
 */

import { describe, expect, it } from "vitest";
import { BackendError } from "../errors";
import {
  AMAZON_APP_NAME,
  AMAZON_CLIENT_DOMAIN,
  AMAZON_SCOPE,
  AMAZON_TOKEN_ENDPOINT,
  createAmazonNativeAttempt,
  isAmazonAllowedNavigation,
  isAmazonReturnAddress,
  parseUniqueQuery,
  pkceChallenge,
} from "./amazonNative";

function testReturn(attempt: ReturnType<typeof createAmazonNativeAttempt>, code = "test-code"): URL {
  const fields = parseUniqueQuery(new URL(attempt.signInUrl).search);
  return new URL(`${fields["openid.return_to"]}&openid.oa2.authorization_code=${encodeURIComponent(code)}&openid.oa2.scope=${AMAZON_SCOPE}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("amazonNative", () => {
  it("matches the RFC 7636 S256 PKCE vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds an authorization-code sign-in URL without Insight or a client secret", () => {
    const a = createAmazonNativeAttempt({ appVersion: "0.6.0" });
    const b = createAmazonNativeAttempt({ appVersion: "0.6.0" });
    const fields = parseUniqueQuery(new URL(a.signInUrl).search);
    const other = parseUniqueQuery(new URL(b.signInUrl).search);
    expect(new URL(a.signInUrl).hostname).toBe("www.amazon.com");
    expect(fields["openid.oa2.response_type"]).toBe("code");
    expect(fields["openid.oa2.scope"]).toBe(AMAZON_SCOPE);
    expect(a.signInUrl).not.toContain("insight");
    expect(a.signInUrl).not.toContain("client_secret");
    expect(fields.client_id).toBeUndefined();
    expect(fields["openid.oa2.client_id"]).not.toBe(other["openid.oa2.client_id"]);
    expect(fields["openid.oa2.code_challenge"]).not.toBe(other["openid.oa2.code_challenge"]);
    expect(fields["openid.return_to"]).not.toBe(other["openid.return_to"]);
  });

  it("binds the exchange body to the attempt's client and PKCE verifier", () => {
    const attempt = createAmazonNativeAttempt({ appVersion: "0.6.0" });
    const fields = parseUniqueQuery(new URL(attempt.signInUrl).search);
    const code = attempt.authorizationCode(testReturn(attempt));
    expect(code).toBe("test-code");
    expect(fields["openid.oa2.code_challenge"]).toBe(pkceChallenge(attempt.verifier));
    expect(fields["openid.oa2.client_id"]).toBe(`device:${attempt.client}`);
  });

  it("rejects bad return addresses, duplicate state, scope and injected codes", () => {
    const attempt = createAmazonNativeAttempt({ appVersion: "0.6.0" });
    const other = createAmazonNativeAttempt({ appVersion: "0.6.0" });
    const good = testReturn(attempt).href;
    const bad = [
      good.replace("www.amazon.com", "www.amazon.com.evil.test"),
      good.replace("https://", "http://"),
      good.replace("/ap/maplanding", "/ap/other"),
      `${good}&state=duplicate`,
      `${good}#fragment`,
      good.replace(AMAZON_SCOPE, "profile"),
      good.replace("test-code", "bad%0D%0Acode"),
      testReturn(other).href,
    ];
    for (const value of bad) {
      expect(() => attempt.authorizationCode(value)).toThrow(BackendError);
    }
  });

  it("rejects insecure and unrelated navigation destinations", () => {
    for (const value of [
      "http://www.amazon.com/",
      "https://www.amazon.com.evil.test",
      "https://user@www.amazon.com/",
      "https://www.amazon.com:8443/",
      "file:///C:/example",
      "https://insight.eero.com/",
    ]) {
      expect(isAmazonAllowedNavigation(value)).toBe(false);
    }
    expect(isAmazonAllowedNavigation("https://www.amazon.com/ap/signin")).toBe(true);
    expect(isAmazonAllowedNavigation("https://amazon.co.uk/ap/signin")).toBe(true);
    expect(isAmazonReturnAddress("https://www.amazon.com/ap/maplanding?state=x")).toBe(true);
    expect(isAmazonReturnAddress("https://www.amazon.com/ap/maplanding#x")).toBe(false);
  });

  it("exchanges a code once at the token endpoint with no cookies", async () => {
    const calls: RequestInit[] = [];
    const attempt = createAmazonNativeAttempt({
      appVersion: "0.6.0",
      fetch: async (input, init) => {
        expect(String(input)).toBe(AMAZON_TOKEN_ENDPOINT);
        calls.push(init ?? {});
        const headers = new Headers(init?.headers);
        expect(headers.get("Cookie")).toBeNull();
        expect(headers.get("Authorization")).toBeNull();
        expect(headers.get("x-amzn-identity-auth-domain")).toBe("api.amazon.com");
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.source_token).toBe("test-code");
        expect(body.source_token_type).toBe("authorization_code");
        expect(body.app_name).toBe(AMAZON_APP_NAME);
        expect(body.client_domain).toBe(AMAZON_CLIENT_DOMAIN);
        expect(body.client_id).toBe(attempt.client);
        expect(body.code_verifier).toBe(attempt.verifier);
        return jsonResponse({ token_type: "bearer", access_token: "test-amazon-access", expires_in: 3600 });
      },
    });
    await expect(attempt.exchange(testReturn(attempt))).resolves.toBe("test-amazon-access");
    await expect(attempt.exchange(testReturn(attempt))).rejects.toMatchObject({
      code: "eero_error",
      message: /already been used/,
    });
    expect(calls).toHaveLength(1);
  });

  it("rejects malformed bearer responses and redirects", async () => {
    for (const result of [
      { token_type: "mac", access_token: "test" },
      { token_type: "bearer" },
      { token_type: "bearer", access_token: "bad\r\nCookie:bad" },
    ]) {
      const attempt = createAmazonNativeAttempt({
        appVersion: "0.6.0",
        fetch: async () => jsonResponse(result),
      });
      await expect(attempt.exchange(testReturn(attempt))).rejects.toMatchObject({ code: "eero_error" });
    }
    const redirect = createAmazonNativeAttempt({
      appVersion: "0.6.0",
      fetch: async () => {
        throw new TypeError("redirect");
      },
    });
    await expect(redirect.exchange(testReturn(redirect))).rejects.toMatchObject({ code: "network_error" });
  });

  it("maps known Amazon token errors without echoing error_description", async () => {
    const attempt = createAmazonNativeAttempt({
      appVersion: "0.6.0",
      fetch: async () =>
        jsonResponse({ error: "invalid_grant", error_description: "test-sensitive-phrase" }, 401),
    });
    try {
      await attempt.exchange(testReturn(attempt));
      expect.unreachable("expected rejection");
    } catch (err) {
      expect(err).toMatchObject({
        code: "eero_error",
        detail: { eeroError: "amazon.token.exchange.invalid_grant", status: 401 },
      });
      expect(String(err)).not.toContain("test-sensitive-phrase");
    }
  });
});
