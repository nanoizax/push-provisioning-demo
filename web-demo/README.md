# WalletPush — interactive demo

A single self-contained [`index.html`](index.html) that visualizes both push-provisioning
flows (Apple Wallet & Google Pay) with a phone mockup, an animated sequence between the app,
the issuer/TSP, the card network and the wallet, and a live payload inspector. It works fully
offline and needs no build step.

## Run it

The simplest way — just open the file:

```bash
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

Or serve it over HTTP — handy when a `file://` origin is inconvenient (e.g. to exercise
**Live API** mode against the backend):

```bash
node serve.mjs         # -> http://localhost:5510   (zero dependencies)
```

## Languages

The UI ships in **English, Español and Português (Lisboa)** — pick one from the switcher in
the top bar. It also auto-detects the browser language (and defaults to Portuguese on
`*lisboa*` hosts). Force a language with `?lang=en|es|pt`.

## Modes

- **Simulated** (default) — runs entirely client-side with realistic sample payloads; no
  backend required.
- **Live API** — calls the issuer/TSP backend on `http://localhost:8787` (start it with
  `cd ../server && npm start`) and shows the real encrypted payloads plus the decrypted proof.
