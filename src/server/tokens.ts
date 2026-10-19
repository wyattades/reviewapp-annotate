import { base64UrlToBytes, bytesToBase64Url } from "./base64url";

/** Who a widget sign-in token is for, and the one review app it works from. */
export type TokenClaims = {
  origin: string;
  name: string;
  userId: string;
  image?: string;
};

const VERSION = "rc1";
const MIN_SECRET_LENGTH = 16;

/**
 * The sign-in tokens the widget keeps: `rc1.<claims>.<hmac>`, signed with the
 * `secret` you pass, so there is nothing to store. They stop working after
 * `ttlSeconds`, and rotating the secret revokes them all.
 */
export function createTokens({
  secret,
  ttlSeconds,
  now = Date.now,
}: {
  secret: string;
  ttlSeconds: number;
  now?: () => number;
}) {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      "The review comments token secret is missing or too short.",
    );
  }

  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`reviewapp-annotate:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signed = (payload: string) =>
    new TextEncoder().encode(`${VERSION}.${payload}`);

  return {
    async sign(claims: TokenClaims) {
      const iat = Math.floor(now() / 1000);
      const payload = bytesToBase64Url(
        new TextEncoder().encode(
          JSON.stringify({ claims, iat, exp: iat + ttlSeconds }),
        ),
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        await key,
        signed(payload),
      );
      return `${VERSION}.${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
    },

    /** The claims, or null when it isn't ours, was altered, or has expired: every failure looks the same. */
    async verify(token: string): Promise<TokenClaims | null> {
      const [version, payload, signature, extra] = token.split(".");
      if (
        version !== VERSION ||
        !payload ||
        !signature ||
        extra !== undefined
      ) {
        return null;
      }
      try {
        const valid = await crypto.subtle.verify(
          "HMAC",
          await key,
          base64UrlToBytes(signature),
          signed(payload),
        );
        if (!valid) return null;

        const { claims, exp } = JSON.parse(
          new TextDecoder().decode(base64UrlToBytes(payload)),
        ) as { claims?: Partial<TokenClaims>; exp?: number };
        if (!exp || exp <= Math.floor(now() / 1000)) return null;
        if (
          typeof claims?.origin !== "string" ||
          typeof claims.name !== "string" ||
          typeof claims.userId !== "string"
        ) {
          return null;
        }
        return {
          origin: claims.origin,
          name: claims.name,
          userId: claims.userId,
          ...(typeof claims.image === "string" && { image: claims.image }),
        };
      } catch {
        return null;
      }
    },
  };
}
