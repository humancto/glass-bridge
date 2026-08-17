import {
  decodeGridFrame,
  type GridDecodeAttempt,
  type GridRegistration,
  type PixelBuffer,
} from "../phy/grid/grid-codec";
import {
  decodeGridWithFreshFallback,
  GridReacquisitionBackoff,
  type GridRegistrationDecode,
} from "./grid-registration";
import { isValidOpticalFrame } from "./transport";

const GRID_REGISTRATION_REFRESH_JOBS = 15;
const GRID_FAILED_REACQUIRE_COOLDOWN_JOBS = 2;

export type GridWorkerDecode = GridRegistrationDecode & {
  validFrame: boolean;
};

/** Stateful Grid path used by one Web Worker and directly exercised by tests. */
export class GridWorkerDecoder {
  private registration: GridRegistration | undefined;
  private jobsSinceRegistration = 0;
  private readonly reacquisitionBackoff = new GridReacquisitionBackoff(
    GRID_FAILED_REACQUIRE_COOLDOWN_JOBS,
  );

  decode(image: PixelBuffer): GridWorkerDecode {
    const refreshRegistration = !this.registration ||
      this.jobsSinceRegistration >= GRID_REGISTRATION_REFRESH_JOBS;
    const registration = refreshRegistration ? undefined : this.registration;
    const recovery = registration && !this.reacquisitionBackoff.allowsFreshAttempt
      ? {
          decoded: decodeGridFrame(image, registration),
          registrationReused: true,
          reacquiredSameFrame: false,
        }
      : decodeGridWithFreshFallback(
          registration,
          (candidate) => decodeGridFrame(image, candidate),
          canKeepGridRegistration,
        );
    const validFrame = validAttempt(recovery.decoded);

    // Persistent low-quality/rolling-shutter exposures must not force two full
    // Grid decodes on every job. A failed fresh retry backs off for two jobs.
    this.reacquisitionBackoff.observe({
      refreshed: refreshRegistration,
      validFrame,
      reacquiredSameFrame: recovery.reacquiredSameFrame,
    });
    if (refreshRegistration || recovery.reacquiredSameFrame) {
      this.registration = recovery.decoded.registration;
      this.jobsSinceRegistration = 0;
    } else if (recovery.decoded.registration) {
      this.registration = recovery.decoded.registration;
    }
    this.jobsSinceRegistration += 1;
    return { ...recovery, validFrame };
  }
}

function canKeepGridRegistration(attempt: GridDecodeAttempt): boolean {
  if (attempt.outcome === "invalid-image" || attempt.outcome === "contrast-low") {
    return true;
  }
  return validAttempt(attempt);
}

function validAttempt(attempt: GridDecodeAttempt): boolean {
  return attempt.outcome === "decoded" &&
    attempt.frame !== undefined &&
    isValidOpticalFrame(attempt.frame);
}
