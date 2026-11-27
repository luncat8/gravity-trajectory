
## trade trajectories

new settings select background trade: 
- disabled : also in lite mode
- lines (current default)
- curves : in this mode, in case of gravity bodies do not move, after game start in background in low priority precalculate trajectories and move trade ships on gravity trajectories.

evacuation ship also use both features: 
- curved real trajectories, moving planet to planet till reach destination. no need to artificially fit journey time to hardcoded value, just set reasonable speeds.
- precalculated field

## precalculate gravity

checkbox pre-calculate gravity field or mass field or force field then move all incl ships and background trade by this field. 
use interpolation between cells.
think or measure is it better performance during game.
background trade anyway use cached trajectories.


## GPU engine

plan to implement WebGL engine - if available then:
precalculated field and FFT can do on GPU if these modes selected. and better resolution.
also view modes and space weather.