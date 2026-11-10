---
"paperlab": patch
---

A letter fold now closes flat: the bottom flap folds all the way first, then the top flap over it on a wider crease, instead of the two flaps passing through each other (165° and 150° before, 179° and 177° now). Unfolding opens the top flap first.

A Field can be dragged after its stage is paused and played again. The field's mesh lost its `raycast` method when `onSelect` came back (R3F resets a removed prop to 0 for meshes whose constructor takes arguments), and the next pointer event threw `e.raycast is not a function`.
