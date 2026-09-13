---
'paperlab': minor
---

A sheet can stand on a floor.

`scene.floor` puts dark, matte ground under the paper: `{ enabled, color, y, roughness }`, off by default. With it on, the contact shadow, a simulated sheet and anything the paper lets go of all meet at the same height, so a falling piece lands on the thing casting its shadow instead of through it. It is also what the warm light of a `<Paper damage>` burn pools on.
