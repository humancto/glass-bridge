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
    const registration = this.registration;
    const refreshRegistration = registration !== undefined &&
      this.jobsSinceRegistration >= GRID_REGISTRATION_REFRESH_JOBS;
    let recovery: GridRegistrationDecode;
    if (refreshRegistration) {
      // A periodic refresh is only a candidate. A single exposure can lose the
      // marker colours to glare or rolling shutter while remaining byte-exact
      // under the last verified homography, so never discard that known-good
      // registration merely because the fresh marker scan failed.
      const fresh = decodeGridFrame(image);
      if (validAttempt(fresh)) {
        recovery = {
          decoded: fresh,
          registrationReused: false,
          reacquiredSameFrame: false,
        };
      } else {
        const cached = decodeGridFrame(image, registration);
        const preferred = preferGridAttempt(cached, fresh);
        recovery = {
          decoded: preferred,
          registrationReused: preferred === cached,
          // Fresh registration failed. A verified cached homography rescued
          // this exposure; do not count that as successful reacquisition.
          reacquiredSameFrame: false,
        };
      }
    } else {
      recovery = registration && !this.reacquisitionBackoff.allowsFreshAttempt
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
    }
    const validFrame = validAttempt(recovery.decoded);

    // Persistent low-quality/rolling-shutter exposures must not force two full
    // Grid decodes on every job. A failed fresh retry backs off for two jobs.
    this.reacquisitionBackoff.observe({
      refreshed: refreshRegistration || registration === undefined,
      validFrame,
      reacquiredSameFrame: recovery.reacquiredSameFrame,
    });
    if (
      validFrame &&
      !recovery.registrationReused &&
      recovery.decoded.registration
    ) {
      this.registration = recovery.decoded.registration;
      this.jobsSinceRegistration = 0;
    } else if (refreshRegistration) {
      // The refresh was attempted, so wait another bounded interval before
      // paying for it again. The previous verified registration stays active.
      this.jobsSinceRegistration = 0;
    }
    this.jobsSinceRegistration += 1;
    return { ...recovery, validFrame };
  }
}

function preferGridAttempt(
  cached: GridDecodeAttempt,
  fresh: GridDecodeAttempt,
): GridDecodeAttempt {
  const progress: Record<GridDecodeAttempt["outcome"], number> = {
    "invalid-image": 0,
    "markers-not-found": 1,
    "geometry-invalid": 2,
    "contrast-low": 3,
    "frame-magic-invalid": 4,
    decoded: 5,
  };
  return progress[cached.outcome] >= progress[fresh.outcome] ? cached : fresh;
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
