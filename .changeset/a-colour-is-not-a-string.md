---
'paperlab': minor
---

Mark every colour field with `.describe('color')`, and publish `sceneSchema`.

A colour is a string the way a date is a string, and a schema-driven panel had
no way to tell the difference — so twelve colour fields across content, wash,
light and the stage rendered as text boxes you had to type hex into. The schema
now says which strings are pigments, rather than asking every consumer to guess
from field names: `color` and `secondary` are both colours, `font` and `text`
are both not, and no rule over names separates them.

`sceneSchema` becomes public because `<PaperField>` now takes one.
