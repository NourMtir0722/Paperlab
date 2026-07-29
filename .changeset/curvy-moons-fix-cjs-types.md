---
"paperlab": patch
---

Fix CommonJS consumers resolving ESM-flavored type declarations: the `require` export condition now points to `dist/index.d.cts`, so `require('paperlab')` gets correctly-flavored types under `node16` module resolution.
