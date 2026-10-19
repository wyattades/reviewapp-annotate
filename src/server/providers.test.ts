/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeOrigin } from "./origin";
import {
  cloudflare,
  netlify,
  previewHostname,
  previewHosts,
  vercel,
} from "./providers";

// the comment bodies below are real ones, trimmed

describe("netlify", () => {
  const comment = (
    previewUrl: string,
  ) => `### <span aria-hidden="true">✅</span> Deploy Preview for *acme* ready!


| Name | Link |
|:-:|------------------------|
|<span aria-hidden="true">🔨</span> Latest commit | 6f1d2c9 |
|<span aria-hidden="true">🔍</span> Latest deploy log | https://app.netlify.com/projects/acme/deploys/68f5 |
|<span aria-hidden="true">😎</span> Deploy Preview | [${previewUrl}](${previewUrl}) |
|<span aria-hidden="true">📱</span> Preview on mobile | <details><summary> Toggle QR Code... </summary><br /><br />_Use your smartphone camera to open QR code link._</details> |
---
_To edit notification comments on pull requests, go to your [Netlify project configuration](https://app.netlify.com/projects/acme/configuration/notifications#deploy-notifications)._`;

  it("reads the deploy preview, not Netlify's own links", () => {
    assert.deepEqual(
      netlify().parseUrls(
        comment("https://deploy-preview-12--acme.netlify.app"),
      ),
      ["deploy-preview-12--acme.netlify.app"],
    );
  });

  it("reads a custom domain just as well", () => {
    assert.deepEqual(
      netlify().parseUrls(comment("https://pr-12.preview.example.com")),
      ["pr-12.preview.example.com"],
    );
  });

  it("ignores a comment that isn't Netlify's", () => {
    assert.deepEqual(
      netlify().parseUrls(
        "Deploy Preview | [https://a.example.com](https://a.example.com)",
      ),
      [],
    );
  });
});

describe("vercel", () => {
  const comment = (previewUrl: string) => `[vc]: #abc=:eyJ4IjoxfQ==
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/acme/web"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_x&s=32" alt="" /></sup></a> [web](https://vercel.com/acme/web) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/acme/web/5r5qbSCLXs1SSuexD4ocHKGz1GeL) | [Preview](${previewUrl}) | <relative-time datetime="2026-10-19T17:30:57.077Z">Oct 19, 2026 5:30pm UTC</relative-time> |

<a href="https://vercel.com/vercel-agent/request-review?owner=acme&repo=web&pr=18" rel="noreferrer"><img src="https://agents-vade-review.vercel.sh/request-review-light.svg" alt="Request Review"></a>`;

  it("reads the preview link, not Vercel's own", () => {
    assert.deepEqual(
      vercel().parseUrls(comment("https://web-git-feature-acme.vercel.app")),
      ["web-git-feature-acme.vercel.app"],
    );
  });

  it("reads a custom branch domain just as well", () => {
    assert.deepEqual(
      vercel().parseUrls(comment("https://staging.example.com")),
      ["staging.example.com"],
    );
  });

  it("ignores a comment that isn't Vercel's", () => {
    assert.deepEqual(vercel().parseUrls("[Preview](https://example.com)"), []);
  });
});

describe("cloudflare", () => {
  it("reads Workers' commit and branch preview URLs", () => {
    const body = `## Deploying with Cloudflare Workers
| Status | Name | Latest Commit | Preview URL | Updated (UTC) |
| -|-|-|-|-|
| ✅ Deployment successful! <br>[View logs](https://dash.cloudflare.com/?to=/a196/workers/services/view/za/production/builds/7f11) | za-docs-telemetry | b86d2a1b | <a href='https://469c7691-za-docs-telemetry.acme-dev.workers.dev'>Commit Preview URL</a><br><br><a href='https://chore-update-submodules-za-docs-telemetry.acme-dev.workers.dev'>Branch Preview URL</a> | Oct 18 2026 |`;
    assert.deepEqual(cloudflare().parseUrls(body), [
      "469c7691-za-docs-telemetry.acme-dev.workers.dev",
      "chore-update-submodules-za-docs-telemetry.acme-dev.workers.dev",
    ]);
  });

  it("reads the other Workers comment, which doesn't say Workers", () => {
    // as left on a real PR: no product name, just "Cloudflare" and a bare URL
    const body = `## 🚀 Deploying Preview to Cloudflare 🚀
<!-- Preview URL -->
### Preview URL: https://cursor-feature-phase-1-2-4dc5-acme-landing.acme-dev.workers.dev (commit a34ce25)
###### This URL reflects your latest Preview deployment`;
    assert.deepEqual(cloudflare().parseUrls(body), [
      "cursor-feature-phase-1-2-4dc5-acme-landing.acme-dev.workers.dev",
    ]);
  });

  it("reads Pages' preview and branch preview URLs, custom domains too", () => {
    const body = `## Deploying 2020-website-archive with Cloudflare Pages
<table><tr><td><strong>Preview URL:</strong></td><td>
<a href='https://37db1633.website-b1o.pages.dev'>https://37db1633.website-b1o.pages.dev</a>
</td></tr>
<tr><td><strong>Branch Preview URL:</strong></td><td>
<a href='https://staging.example.org'>https://staging.example.org</a>
</td></tr></table>
[View logs](https://dash.cloudflare.com/?to=/31fd/pages/view/2020-website-archive/37db1633)`;
    assert.deepEqual(cloudflare().parseUrls(body), [
      "37db1633.website-b1o.pages.dev",
      "staging.example.org",
    ]);
  });

  it("ignores a comment that isn't Cloudflare's", () => {
    assert.deepEqual(
      cloudflare().parseUrls("Preview URL: https://example.com"),
      [],
    );
  });
});

describe("previewHostname", () => {
  it("takes a URL or a bare hostname, in any case", () => {
    assert.equal(
      previewHostname("https://PR-12.Example.com/path?x=1"),
      "pr-12.example.com",
    );
    assert.equal(previewHostname("http://a.example.com"), "a.example.com");
    assert.equal(previewHostname(" A.Example.com. "), "a.example.com");
  });

  it("refuses what isn't one", () => {
    assert.equal(previewHostname("not a host"), null);
    assert.equal(previewHostname(""), null);
  });
});

describe("previewHosts", () => {
  it("takes only links that call themselves a preview", () => {
    assert.deepEqual(
      previewHosts(
        "[docs](https://docs.example.com) and [Visit Preview](https://a.example.net) and <a href='https://b.example.net'>Preview</a>",
      ),
      ["a.example.net", "b.example.net"],
    );
  });
});

describe("normalizeOrigin", () => {
  it("normalizes an https origin on any domain", () => {
    assert.deepEqual(normalizeOrigin("https://ABC.Example.com/path?x=1"), {
      origin: "https://abc.example.com",
      hostname: "abc.example.com",
    });
  });

  it("refuses what can't be a review app", () => {
    for (const origin of [
      "http://x.herokuapp.com",
      "https://x.herokuapp.com:8443",
      "https://localhost",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      assert.equal(normalizeOrigin(origin), null, String(origin));
    }
  });
});
