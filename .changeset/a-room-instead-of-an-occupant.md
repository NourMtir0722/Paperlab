---
"paperlab": minor
---

The stage is a room now, and there is nobody in it.

### `stage.room` and `ground.slab`

A ceiling, and seams in the floor. Together they are the scale of the hall.

Stage mode was a void with a horizon — a graded dome, a flat plane, and a bright rectangle at the end, and **not one thing in it was a knowable size**. That is the real reason the walking figure existed, and it is why removing the figure on its own would have left an abstraction rather than a room.

Architecture answers it better, for a reason worth stating plainly: a concrete floor is poured in bays of about two and a half metres and a ceiling sits about three above your head, and a viewer knows both of those without being told. They are also flat surfaces under good light — the one thing a renderer never gets wrong — where a human mesh is the one thing it always does.

The ceiling earns its place twice. It gives the haze a far surface to **end** on, which is why the top of frame used to grade away to nothing; and it puts a horizontal plane above the walk for the source to spill onto, which is how every reference installation reads as interior — you can see the light landing on the ceiling.

The floor was `#0e0b09`, which is dark enough to disappear, and a floor that disappears cannot show the seams that are the entire point of it. Lifted to `#241e19`: the hall keeps its contrast against the source and gains a surface you can read the size of the room from.

### `showFigure` defaults to `false`

The figure was doing a real job and the instinct behind it was right. The instrument was wrong.

The deciding argument is not that the model looked cheap — it is that **the stage is navigable**. Drag, wheel, arrow-step, click the banner you want to stand in front of: there is already a person in that hall, and it is the viewer. A second one walking the same aisle on its own clock competes for the role, and the viewer cannot tell whether they are the camera or the character. Every installation this mode is modelled on answers that question the same way: you are the one walking.

Still one flag away for anyone who wants it, and the walk system, the gait and the camera binding are untouched — none of that ever needed a visible body.

**`describeStage` gained a fix from this.** The camera was named inside the figure's own clause, so turning the figure off silently took the *shot* out of the description too — and the shot is what the reader is actually looking through. It is named unconditionally now, the room is described, and no figure is claimed when none is drawn. A brief that promises a walking person the render does not contain is worse than a terse one.

### One room with a colour in it

`threshold` — a few enormous sheets, wide enough apart to walk between — is now terracotta.

Every stage in the set was a warm neutral corridor, and white paper against warm neutral is white paper against nothing: the sheets and the room sit at the same temperature and the picture flattens. Against a saturated ground the paper sings, which is why the installations worth copying are shot in rooms painted terracotta and washed with gels rather than in white boxes. `source.color`, `source.zenith` and `ground.color` are the same three stops that build the environment map, so the light bouncing onto the sheets is the room's own colour and cannot disagree with the walls in shot.

### Smaller

The docs app was shipping a 1.5 MB copy of the walking-figure glTF that nothing in it referenced. Removed; the editor and playground copies stay, because those two do reach it when the figure is switched on.
