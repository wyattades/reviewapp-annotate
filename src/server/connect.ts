/**
 * The page the sign-in popup lands on once the person is signed in to your
 * app: it hands the token to the review app that opened the popup, then closes.
 */
export function connectPage(token: string, origin: string) {
  // `</script>` in the data would end the script early
  const message = JSON.stringify({
    type: "reviewapp-annotate-token",
    token,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<meta charset="utf-8">
<title>Signed in</title>
<body style="font-family:system-ui,sans-serif;padding:16px">
<p>Signed in. You can close this window.</p>
<script>
try { window.opener && window.opener.postMessage(${message}, ${JSON.stringify(origin)}); } catch (e) {}
window.close();
</script>
`;
}

export const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
