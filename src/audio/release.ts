// Finished sounds must be unplugged. A note or effect is a little tree of nodes hanging off a long-lived bus;
// once its sources stop, Chromium still visits every node left connected on every block of audio until the
// garbage collector gets round to it. A boss fight makes thousands of them, so the audio thread slowed a
// little more every second until the sound broke up (and came back when the fight's music bus was dropped).
// Disconnecting a sound's root from its bus takes the whole tree out of the graph at once.

/** Disconnect `nodes` once audio time `at` has passed (live contexts only: offline renders keep everything). */
export function releaseAt(ctx: BaseAudioContext, at: number, ...nodes: AudioNode[]) {
  if (!(ctx instanceof AudioContext)) return;
  const ms = Math.max(0, (at - ctx.currentTime) * 1000) + 250;
  setTimeout(() => {
    for (const n of nodes)
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
  }, ms);
}
