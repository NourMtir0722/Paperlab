---
'paperlab': minor
---

A burnt edge is drawn in layers, and the char band has its own width.

From the hole out, a `<Paper damage>` burn now draws a pale ash lip, the ember line, a black char band, and a dark scorch with a steep edge into clean paper. The lip used to be a hairline; it now defaults to 3.5 mm, as wide as the char. `DamageLook` takes a new `charWidth` (mm, default 3.5), and `lipWidth` now means the whole width of the lip.
