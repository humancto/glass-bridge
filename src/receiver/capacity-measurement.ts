import type { TransferProgress } from "./transport";

export type TransportMeasurement = {
  payloadBytesPerSecond: number;
  seconds: number;
  acceptedCodes: number;
  acceptedCodesPerSecond: number;
  symbolSize: number;
  fountainOverhead: number;
  payloadEfficiency: number;
};

export function measureTransport(
  payloadBytes: number,
  seconds: number,
  completion: TransferProgress,
): TransportMeasurement {
  if (
    !Number.isSafeInteger(payloadBytes) || payloadBytes <= 0 ||
    !Number.isFinite(seconds) || seconds <= 0 ||
    completion.acceptedFrames <= 0 ||
    completion.required <= 0 ||
    completion.symbolSize <= 0
  ) {
    throw new Error("Capacity measurement requires a completed bounded transfer.");
  }
  return {
    payloadBytesPerSecond: payloadBytes / seconds,
    seconds,
    acceptedCodes: completion.acceptedFrames,
    acceptedCodesPerSecond: completion.acceptedFrames / seconds,
    symbolSize: completion.symbolSize,
    fountainOverhead: Math.max(0, completion.acceptedFrames / completion.required - 1),
    payloadEfficiency: payloadBytes / (completion.acceptedFrames * completion.symbolSize),
  };
}
