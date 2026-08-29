---
'paperlab': minor
---

Fix the roll geometry: paper no longer passes through itself, and a roll now shrinks as it pays out.

`roll` derived its circle's centre from the current radius, so every wrap was tangent to the sheet at the same point — a rosette of circles through one point rather than a spiral. The sheet intersected itself once per revolution, and because the error cancelled exactly at multiples of 2π it was invisible to both the golden vectors and the GPU parity gate. The centre is now fixed and only the radius varies, so the wraps are concentric and sit exactly one layer apart.

The winding also runs the correct way round. Paper is dispensed off the outside of a roll, so the end you are holding has to be the outermost layer and the far end has to sit at the core; it used to be the other way round. Arc length is now preserved all the way in, not just on the first turn.

**Breaking:** the `roll` deformer's `spiral` option (radius growth per radian) is replaced by `thickness` (the gap between consecutive wraps, in world units). `spiral` could not express a real roll and did nothing at all at whole turns. Serialized `.paper` configs that set `roll.spiral` need the key renamed; the value is a layer gap now, not a growth rate, so re-tune it by eye.

`unroll` gains `from` (`'bottom'` for a receipt feeding down, `'top'` for paper hanging below the roll), `core` (the tube the paper is wound onto), and `fixed` (hold the roll still in space and let the paper travel instead of the other way round). Its radius is now derived from how much paper is left rather than being a constant, so the roll visibly runs down to its core — bind `progress` to scroll and you can pay a sheet out until it ends. New `paper-roll` preset does exactly that.
