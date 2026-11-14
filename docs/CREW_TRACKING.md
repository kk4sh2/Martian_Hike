# Suit-integrated crew tracking (simulated)

Code: `web/src/core/crew.ts`. Everything on this page is simulated, and the UI labels it as simulated.

- **No GPS and no browser geolocation.** Positions come from a simulated local radio network. It has three fixed anchors with surveyed local coordinates: the habitat mast, the pressurised rover and a relay mast.
- **Suit beacons.** SUIT-A1 and SUIT-B2 are worn. SUIT-S3 is a spare. Each beacon ranges to the anchors.
  - Range noise σ = 0.3 m + 0.2% of range.
  - The fix is a weighted least-squares trilateration.
  - The uncertainty shown is the 2σ radius of the solution covariance's major axis.
- **Tablets.** TAB-1 and TAB-2 are separate devices with their own state. The map always shows the *suit beacon* position. A tablet is never treated as the astronaut.
- **Fix states.**
  - **LIVE**: a fix arrived within the update interval.
  - **LAST KNOWN**: the link is down. The last fix is frozen and shown with its age ("last contact m:ss ago").
  - On link restore the state returns to LIVE.

## Demonstration cases (tablet view, "Crew scenarios")

1. **Tablet left behind.** TAB-1 is dropped at a fixed point. The UI says "TAB-1 is not with its wearer" and gives the distance to SUIT-A1's beacon.
2. **Suit link lost, then restored.** SUIT-B2 goes to LAST KNOWN with the fix age shown. After restore it is LIVE again.
3. **Spare suit powered on.** SUIT-S3 reports a LIVE location with the note "Wearer unconfirmed". A beacon reports where the *suit* is and cannot confirm that a person is wearing it.

All crew events go to the mission log, marked as simulated.
