import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapacityScorecard } from "../src/receiver/ReceiverApp";
import type { CapacityComparison, CapacityReport } from "../src/receiver/capacity-report";

const report: CapacityReport = {
  schema: "glassbridge-capacity/3",
  measured_at: "2026-08-05T01:02:03.000Z",
  profile: { id: "burst", label: "Burst", lanes: 2, qr_version: 30 },
  transfer_session: "09090909",
  file_bytes: 147_456,
  payload_sha256: "ab".repeat(32),
  transfer_seconds: 2.4,
  verified_payload_bytes_per_second: 61_440,
  accepted_codes: 96,
  required_codes: 88,
  duplicate_codes: 3,
  rejected_codes: 7,
  observed_codes: 106,
  accepted_codes_per_second: 40,
  accepted_symbol_bytes_per_second: 67_520,
  symbol_bytes: 1_688,
  decoded_acceptance_percent: 90.6,
  fountain_overhead_percent: 9.1,
  payload_efficiency_percent: 91,
  transport: {
    encoding: "gzip",
    signed_envelope_bytes: 148_000,
    optical_object_bytes: 32_000,
    optical_reduction_percent: 78.4,
  },
  camera: {
    observed_fps: 59.9,
    negotiated_fps: 60,
    width: 1_280,
    height: 720,
    valid_codes_per_second: 40,
    busy_drops: 2,
    decode_p50_ms: 4.2,
    decode_p95_ms: 8.5,
    workers: 4,
    decode_jobs: 120,
    successful_decode_jobs: 82,
    empty_decode_jobs: 38,
    optical_acquisition_percent: 68.3,
  },
  device: "test-phone",
};

describe("post-receive analytics scorecard", () => {
  it("keeps the comparable result visible with export actions and diagnostics", () => {
    const comparison: CapacityComparison = {
      runNumber: 3,
      previousGoodput: 55_000,
      previousAcceptedCodesPerSecond: 28.4,
      bestGoodputBefore: 58_000,
      bestAcceptedCodesPerSecond: 31.2,
      changeFromPrevious: 61_440 / 55_000 - 1,
      changeFromBest: 61_440 / 58_000 - 1,
      isNewBest: true,
    };
    const html = renderToStaticMarkup(createElement(CapacityScorecard, {
      report,
      comparison,
      historySaved: true,
      status: "Benchmark JSON copied.",
      onCopy: () => undefined,
      onShare: () => undefined,
    }));
    expect(html).toContain("Post-receive transfer analytics");
    expect(html).toContain("60.0 KiB/s");
    expect(html).toContain("NEW BEST");
    expect(html).toContain("+11.7%");
    expect(html).toContain("28.4 codes/s");
    expect(html).toContain("first accepted code → verified");
    expect(html).toContain("90.6%");
    expect(html).toContain("Pipeline diagnostics");
    expect(html).toContain("68.3%");
    expect(html).toContain("gzip · 31.3 KiB transmitted · 78.4% reduction");
    expect(html).toContain("Copy benchmark JSON");
    expect(html).toContain("Save / share benchmark JSON");
    expect(html).toContain("last 20 runs retained");
    expect(html).toContain("comparisons match device + visual PHY + target rate + exact payload");
    expect(html).toContain("Benchmark JSON copied.");
  });
});
