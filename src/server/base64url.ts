/** Base64url for text, without Node's `Buffer`, so this runs anywhere `btoa` does. */

const bytesToBinary = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

export function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(bytesToBinary(bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlToBytes(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export const encodeBase64Url = (text: string) =>
  bytesToBase64Url(new TextEncoder().encode(text));

export const decodeBase64Url = (text: string) =>
  new TextDecoder().decode(base64UrlToBytes(text));
