---
'paperlab': patch
---

A sheet in a canvas that draws only on demand (`frameloop="demand"`) now shows its face as soon as the picture loads. The material hands new textures and values to the shader after React's commit, where React Three Fiber doesn't see them, so a face that arrived once nothing else was moving stayed unseen, drawn black, until something asked for another frame. The material now asks for that frame itself, and only when something it draws has changed.
