# Security

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private reporting instead — the [**Security tab → Report a
vulnerability**](https://github.com/NourMtir0722/Paperlab/security/advisories/new).
It opens a thread only you and the maintainer can see, and it is the fastest
way to reach someone.

You can expect an acknowledgement within a week. If a fix is warranted it ships
in a patch release with an advisory credited to you, unless you would rather
not be named.

## Supported versions

The latest published minor is supported. Paperlab is pre-1.0, so fixes land on
the newest release rather than being backported.

## What is in scope

Paperlab renders in the browser and ships no server. The realistic attack
surface is what a **`.paper` file** can do, because those are designed to be
passed between strangers — over a link, in a PR, dropped onto the editor.

In scope:

- A `.paper` file, or a share link, that escapes validation and causes script
  execution, data exfiltration, or navigation.
- A config that crashes or hangs the tab in a way `paperConfigSchema` should
  have refused.
- Anything in the published package that reaches the network. It should never
  do that: it makes no requests, and the demo assets belong to the demo apps.

Out of scope:

- Content you supply yourself. `content.text` is painted to a canvas, not
  parsed as HTML, but an image `src` you pass is fetched by the browser as you
  asked — validate URLs from untrusted sources before handing them over.
- WebGL driver bugs and GPU crashes from hostile geometry values. Report them
  upstream to the browser, though tell us too if the schema should have caught
  the value.
- Denial of service through obviously extreme parameters. The schema clamps
  what it can; a machine can always be asked to render more than it can.

## For anyone consuming this package

Releases publish from GitHub Actions over OIDC trusted publishing, with no
long-lived npm token anywhere in the pipeline. Every release from 0.3.0 onward
carries a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements),
so you can verify a tarball was built from this repository:

```sh
npm audit signatures
```

The package runs **no install scripts**, and neither does anything in its
dependency tree — so it needs no exception under npm 12's install-time
defaults.
