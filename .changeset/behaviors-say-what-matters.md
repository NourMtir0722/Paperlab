---
"paperlab": minor
---

Behaviors nominate the params that matter, and a paper can say where its handle is.

Two additions, both for tools built on top of the library.

**`Behavior.signature`** names the two or three options that ARE a behavior — the ones someone reaches for first, in the order they'd reach for them. Editors give those the loud controls and fold the rest away; the schema still generates a control for every option, so nothing is removed, only ranked. All twelve built-ins nominate one (`peel` → progress, corner; `flight` → gustiness, tumble, path, which puts its three-slider wind vector one disclosure away instead of first). It is **optional and its absence means "show everything"** — the library never hides a param it was not told to hide, because silence from a community behavior is not permission to guess.

**`PaperHandle.handlePoint(id?, target?)`** returns a behavior's grab point in world space, or null when the behavior has no handles. The handle rides the deformed surface, so its position is a fact about the frame, not about the config — nothing outside the render can derive it from a UV, which is why anything that wants to point at the handle (a coach-mark, a tooltip, an arrow) had no way to. Pass `target` and it writes in place, so a per-frame reader does not allocate.
