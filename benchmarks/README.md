# Benchmark evidence

`grid-acquisition-reference.json` is a raw output record from the deterministic
synthetic Grid acquisition workload. Regenerate it from the repository root:

```sh
npm ci
npm run benchmark:grid-acquisition -- --output benchmarks/grid-acquisition-reference.json
```

The report records the Git commit, whether tracked implementation files and
benchmark sources were dirty before the artifact was written, a SHA-256
fingerprint of every benchmark-relevant source/configuration file, and the host
runtime/CPU environment. This makes a result attributable and the workload
reproducible without pretending that timings from unlike hosts are directly
comparable. Untracked files outside the declared source list do not affect the
worktree flag.

## What the result proves

The process exits unsuccessfully when a deterministic correctness gate or the
synthetic solve-window model fails. The byte-exact reconstruction, stable-frame
acquisition, transition-tear rejection, and blur-probe results are useful
regression evidence for the software pipeline.

Host decode timing is reported separately and is advisory. It is meaningful
only when comparing materially identical hardware, runtime, power, and load
conditions. It does not affect the process exit status.

This workload renders and captures frames entirely in software. It does **not**
exercise a display, camera sensor, browser camera pipeline, rolling shutter,
autofocus, exposure control, hand motion, or thermal throttling. It therefore
does not prove phone-camera goodput, physical reliability, completion time, or
superiority over another optical transport. Those claims require exported
camera-mode runs from named physical device pairs under a published protocol.

For release evidence, generate the JSON from a clean implementation commit. If
the file says `git_worktree_dirty: true` or `benchmark_sources_dirty: true`, use
its source fingerprint for attribution and regenerate after the tree is frozen.
