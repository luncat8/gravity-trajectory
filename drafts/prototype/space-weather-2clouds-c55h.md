## Zone design

Each zone is an **iso-contour of a 3D noise density field** `d(x, y, t)`. The threshold `th` sets the boundary, and `d - th` can drive intensity. The 2D slice is taken at `z = t * evo`, so the shape morphs over time. The xy coordinates are offset by `wind * t`, which makes the zone drift like it is carried by space wind. This keeps the shape organic without storing any geometry.

| Variant | Shape | Motion | Gameplay use |
|---|---|---|---|
| **Cloud** | Soft, blobby patches from 4-octave fBm | Slow xy drift plus slow z morph | Ion clouds, radiation haze that slows or damages ships |
| **Filament** | Thin, branching streams from ridged noise | Faster wind, so streams sweep across the map | Solar wind streams, magnetic filaments that deflect shots |
| **Weather** | Persistent storm cells that build and fade | Noise is integrated into a persistent weather layer with decay | Storm fronts that grow and dissipate over minutes |

For the **weather increment**, a persistent layer `W` is updated each frame as `W += dt * k * (noise - 0.5)`, then decayed with `W *= 1 - dt * decay`. The layer therefore changes only where the noise is pushing it, and it forgets old changes. The final density is `base noise + W`. Half-life is about `ln2 / decay`, roughly 23 seconds with the values in the demo.

For multiplayer, seed the noise permutation and the weather layer from a shared seed and sync only `T`. Every client then computes the same field without sending geometry.
