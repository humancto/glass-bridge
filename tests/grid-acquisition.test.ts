import { describe, expect, it } from "vitest";
import {
  GRID_CAMERA_SESSION_LIMIT_MS,
  GRID_INITIAL_ACQUISITION_TIMEOUT_MS,
  GRID_TRANSFER_STALL_MS,
  didGridTransportAdvance,
  gridAcquisitionGuidance,
  gridDecodeTargetFps,
  gridEmptyJobLimit,
  gridSessionLimitGuidance,
  mostInformativeGridOutcome,
  shouldEndGridCameraSession,
  shouldPauseGridAcquisition,
} from "../src/receiver/grid-acquisition";
import { ltFrameIndices } from "../src/protocol/lt-codec";
import { OpticalTransferDecoder } from "../src/receiver/transport";
import { OpticalTransferEncoder } from "../src/sender/transport";

describe("Grid camera acquisition policy", () => {
  it("samples fast enough to observe a fresh symbol without exceeding camera cadence", () => {
    expect(gridDecodeTargetFps(10)).toBe(20);
    expect(gridDecodeTargetFps(30)).toBe(60);
    expect(gridDecodeTargetFps(60)).toBe(60);
  });

  it("allows startup aiming time, then applies a ten-second in-transfer stall", () => {
    const symbolRate = 30;
    const limit = gridEmptyJobLimit(symbolRate);
    expect(limit).toBe(600);
    expect(GRID_INITIAL_ACQUISITION_TIMEOUT_MS).toBe(20_000);
    expect(shouldPauseGridAcquisition({
      symbolRate,
      consecutiveNonProgressJobs: limit,
      elapsedSinceProgressMs: GRID_TRANSFER_STALL_MS,
      hasAcceptedFrame: false,
    })).toBe(false);
    expect(shouldPauseGridAcquisition({
      symbolRate,
      consecutiveNonProgressJobs: limit,
      elapsedSinceProgressMs: GRID_INITIAL_ACQUISITION_TIMEOUT_MS,
      hasAcceptedFrame: false,
    })).toBe(true);
    expect(shouldPauseGridAcquisition({
      symbolRate,
      consecutiveNonProgressJobs: limit,
      elapsedSinceProgressMs: GRID_TRANSFER_STALL_MS - 1,
      hasAcceptedFrame: true,
    })).toBe(false);
    expect(shouldPauseGridAcquisition({
      symbolRate,
      consecutiveNonProgressJobs: limit,
      elapsedSinceProgressMs: GRID_TRANSFER_STALL_MS,
      hasAcceptedFrame: true,
    })).toBe(true);
  });

  it("does not let repeated CRC-invalid PHY codes disarm a stalled transfer", () => {
    const symbolRate = 30;
    const sessionId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const encoder = new OpticalTransferEncoder(new Uint8Array(4_096).fill(23), {
      sessionId,
      symbolSize: 128,
    });
    const decoder = new OpticalTransferDecoder(sessionId);
    const first = decoder.ingestFrame(encoder.frameBytes(0));
    expect(first.acceptedFrames).toBe(1);

    const limit = gridEmptyJobLimit(symbolRate);
    for (let index = 0; index < limit; index += 1) {
      const before = decoder.snapshot();
      const corrupt = encoder.frameBytes(index + 1);
      corrupt[corrupt.length - 1] ^= 1;
      const next = decoder.ingestFrame(corrupt);
      expect(didGridTransportAdvance(before, next)).toBe(false);
    }
    expect(shouldPauseGridAcquisition({
      symbolRate,
      consecutiveNonProgressJobs: limit,
      elapsedSinceProgressMs: GRID_TRANSFER_STALL_MS,
      hasAcceptedFrame: true,
    })).toBe(true);
  });

  it("keeps 155 valid repair-only symbols alive even when LT rank remains zero", () => {
    const sourceCount = 130;
    const repairCount = 155;
    const symbolSize = 16;
    const sessionId = findRepairOnlySession(sourceCount, repairCount);
    const encoder = new OpticalTransferEncoder(
      Uint8Array.from({ length: sourceCount * symbolSize }, (_, index) => index & 0xff),
      {
        sessionId,
        symbolSize,
        frameCount: sourceCount + repairCount,
        codec: "lt-v2",
      },
    );
    const decoder = new OpticalTransferDecoder(sessionId);

    for (let index = 0; index < repairCount; index += 1) {
      const before = decoder.snapshot();
      const next = decoder.ingestFrame(encoder.frameBytes(sourceCount + index));
      expect(didGridTransportAdvance(before, next)).toBe(true);
      expect(next.rank).toBe(0);
    }

    expect(decoder.snapshot()).toMatchObject({
      acceptedFrames: 155,
      rank: 0,
      required: 130,
    });
    expect(shouldEndGridCameraSession(8_000)).toBe(false);
  });

  it("ends only at the absolute 120-second Grid lab-session boundary", () => {
    expect(GRID_CAMERA_SESSION_LIMIT_MS).toBe(120_000);
    expect(shouldEndGridCameraSession(GRID_CAMERA_SESSION_LIMIT_MS - 1)).toBe(false);
    expect(shouldEndGridCameraSession(GRID_CAMERA_SESSION_LIMIT_MS)).toBe(true);
    expect(shouldEndGridCameraSession(GRID_CAMERA_SESSION_LIMIT_MS + 1)).toBe(true);
    expect(gridSessionLimitGuidance()).toContain("120-second Grid lab session limit");
  });

  it("maps acquisition failures to operator-actionable guidance", () => {
    expect(gridAcquisitionGuidance("markers-not-found")).toContain("complete four-marker set");
    expect(gridAcquisitionGuidance("markers-not-found")).toContain("not proof of bad aim");
    expect(gridAcquisitionGuidance("contrast-low")).toContain("brightness");
    expect(gridAcquisitionGuidance("frame-magic-invalid")).toContain("10 symbols/s");
    expect(gridAcquisitionGuidance("decoded")).toContain("reached PHY decoding");
    expect(gridAcquisitionGuidance("decoded", true)).toContain("scanning stopped");
    expect(gridAcquisitionGuidance(undefined)).toContain("twenty seconds");
  });

  it("does not let the final bad exposure erase stronger acquisition evidence", () => {
    let outcome = mostInformativeGridOutcome(undefined, "geometry-invalid");
    outcome = mostInformativeGridOutcome(outcome, "frame-magic-invalid");
    outcome = mostInformativeGridOutcome(outcome, "markers-not-found");
    expect(outcome).toBe("frame-magic-invalid");

    outcome = mostInformativeGridOutcome(outcome, "decoded");
    outcome = mostInformativeGridOutcome(outcome, "invalid-image");
    expect(outcome).toBe("decoded");
  });

  it("rejects invalid scheduling inputs", () => {
    expect(() => gridDecodeTargetFps(0)).toThrow(/positive/);
    expect(() => shouldPauseGridAcquisition({
      symbolRate: 30,
      consecutiveNonProgressJobs: -1,
      elapsedSinceProgressMs: 0,
      hasAcceptedFrame: false,
    })).toThrow(/non-negative/);
    expect(() => shouldEndGridCameraSession(-1)).toThrow(/non-negative/);
  });
});

function findRepairOnlySession(sourceCount: number, repairCount: number): Uint8Array {
  for (let candidate = 0; candidate < 20_000; candidate += 1) {
    const session = new Uint8Array(16);
    new DataView(session.buffer).setUint32(12, candidate, false);
    let allRepairsHaveDegreeAboveOne = true;
    for (let index = 0; index < repairCount; index += 1) {
      if (ltFrameIndices(session, sourceCount + index, sourceCount).length === 1) {
        allRepairsHaveDegreeAboveOne = false;
        break;
      }
    }
    if (allRepairsHaveDegreeAboveOne) return session;
  }
  throw new Error("No deterministic repair-only LT fixture was found.");
}
