---
"paperlab": patch
---

Docs: correct the layout list for agents and humans. `AGENTS.md` still advertised five layouts that do not exist (`deck`, `cascade`, `helix`, `tunnel`, `scatter`) — names from before the layouts were renamed to places paper actually sits — so an agent following it would generate a `<PaperField layout="…">` the registry rejects. The real set is `ring`, `fan`, `spread`, `pile`, `wall`, `spill`, `sweep`, `book`, `accordion`, `rack`, `colonnade`, `sheet`. `docs/llms.txt` and the README were also missing `colonnade`.
