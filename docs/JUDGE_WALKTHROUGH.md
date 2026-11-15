# Two-minute judge walkthrough

Start: `cd demo-pack && python3 serve.py`, then open http://localhost:8080. After this first load you can switch to airplane mode and everything below still works.

**0:00, Nili Patera change (about 60 s).** Click **Demo**, then **Nili Patera** and press **Next** through the steps.
1. The tablet shows the planned walk on the June 30, 2007 HiRISE image. No change analysis appears yet, because only one observation is on board.
2. A simulated event delivers the October 13, 2007 observation, 105 days later.
3. The precomputed comparison loads. It was registered on bedrock with a 0.086 m held-out residual.
4. A candidate change region crosses the route, and the crossing subsegment is highlighted in magenta.
5. The evidence viewer opens. Try **Blink** and **Swipe**. It shows the classification and why, NASA's separate PIA15680 finding with links, and "Displacement unresolved" with the reason.
6. The demo asks for a bypass. MarsDelta explains why none can be offered: no terrain model is packaged for this crop. It then logs the acknowledgement.
7. The mission log records the decision. The success estimate did not change because of the crossing.

To check the other route results, pick route B (clear of all candidates) and route C (leaves the analysed coverage). They show different impact results.

**1:00, Jezero science walk (about 45 s).** Switch the area to **Jezero** and confirm that no Nili polygons or IDs appear.
- **Routes card**: Direct (1.56 km) and Gentle (1.62 km) both include the return leg. The table names the leg that explains the difference.
- **Ground photos**: open one. It shows a real Mastcam-Z frame, its RMC site/drive, sol and camera position, plus a link to NASA's raw-image page.
- **Landing pin**: drag the pin and the briefing updates. The weather card states that MEDA is not packaged. It does not invent values.
- **Can we make it back?**: open "Change supplies and conditions" and set oxygen to 0.16 kg. The estimate drops to about 34% of 500 simulated missions, with oxygen named as the main failure. Press reset.

**1:45, tablet and crew (about 15 s).** Open the **Tablet** view and press **Start**. Under Crew scenarios, try **Drop tablet** (TAB-1 left behind), **Cut link** (SUIT-B2 shows LAST KNOWN with the fix age), and **Restore**.

**Sources** (top bar) holds the technical detail in tabs: datasets with URLs and hashes, the change-analysis method, the planning model, weather and dust, terrain, and crew tracking. **Hide panel** gives the map the full screen.
