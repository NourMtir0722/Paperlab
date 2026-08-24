---
'paperlab': minor
---

Publish `contentNames` and `contentSchemaFor`, so content can be edited the way
everything else already is.

Behaviors, layouts and the stage all hand their editor UI to a caller by
publishing a zod schema and letting it be walked. Content could not: the union
was internal, so the only way to build a panel for a `receipt` was to write one
by hand and keep it in step with the schema — which is exactly what the editor
did, for two of the five types, until `card`, `receipt` and `blank` each opened
onto an empty folder.

`contentNames` is read off the union rather than written beside it, because the
sibling name lists here (`stockNames`, `physicsNames`) are the SOURCE their
schema is built from and this one is not — a hand-written copy would be free to
drift the day a sixth content type lands. `contentSchemaFor` answers which
member carries which discriminator, which is the union's own fact to state
rather than a walk's to rediscover.
