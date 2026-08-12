---
"paperlab": minor
---

`drape`, `crumple` and the `crumple` behavior are now exported like every other deformer and behavior.

`roll`, `curl`, `bend`, `fold` and `wave` were each exported individually — their deformer object, options schema and options type — while `drape` and `crumple` were reachable only through `getDeformer(id)`. Nothing depended on the difference, which is exactly why it was worth closing: an API with an arbitrary hole in it is a papercut for the first person who trips over it, and the reference site now documents all seven.

This is deliberately the *reversible* direction. The alternative was removing all seven, which is a breaking change and belongs to the pre-1.0 export trim rather than to a tidy-up. When that trim happens, the deformer objects and their schemas should go as one group of seven.
