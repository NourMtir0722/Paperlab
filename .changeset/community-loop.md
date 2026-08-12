---
"paperlab": patch
---

Docs: document the community loop. A `.paper` file someone shares with you is already a preset object — `<Paper preset={theirPaper} />` or `registerPreset(name, theirPaper)` — so it goes straight into a project without being expanded into individual props. The README, `AGENTS.md`, and `docs/llms.txt` now say this explicitly, and `config/shared-paper.test.ts` pins the round-trip so the promise cannot silently break. `CONTRIBUTING.md` now leads with the fact that sharing a paper needs no fork and no PR; the contribution ladder is for work you want shipped *inside* the library.
