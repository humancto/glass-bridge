import type {
  GridDecodeAttempt,
  GridRegistration,
} from "../phy/grid/grid-codec";

export type GridRegistrationDecode = {
  decoded: GridDecodeAttempt;
  registrationReused: boolean;
  reacquiredSameFrame: boolean;
};

export class GridReacquisitionBackoff {
  private remainingJobs = 0;

  constructor(private readonly cooldownJobs: number) {
    if (!Number.isSafeInteger(cooldownJobs) || cooldownJobs < 0) {
      throw new Error("Grid reacquisition cooldown must be a non-negative integer.");
    }
  }

  get allowsFreshAttempt(): boolean {
    return this.remainingJobs === 0;
  }

  observe(input: {
    refreshed: boolean;
    validFrame: boolean;
    reacquiredSameFrame: boolean;
  }): void {
    if (input.refreshed || input.validFrame) {
      this.remainingJobs = 0;
    } else if (input.reacquiredSameFrame) {
      this.remainingJobs = this.cooldownJobs;
    } else if (this.remainingJobs > 0) {
      this.remainingJobs -= 1;
    }
  }
}

/**
 * Reusing registration avoids a full marker scan while the camera is stable.
 * If that homography no longer decodes, retry the same exposure immediately:
 * waiting for another camera frame both loses throughput and lets stale
 * registration survive subpixel phone motion.
 */
export function decodeGridWithFreshFallback(
  registration: GridRegistration | undefined,
  decode: (candidate?: GridRegistration) => GridDecodeAttempt,
  accept: (attempt: GridDecodeAttempt) => boolean = (attempt) => attempt.outcome === "decoded",
): GridRegistrationDecode {
  const reused = decode(registration);
  if (!registration || accept(reused)) {
    return {
      decoded: reused,
      registrationReused: registration !== undefined,
      reacquiredSameFrame: false,
    };
  }
  return {
    decoded: decode(undefined),
    registrationReused: false,
    reacquiredSameFrame: true,
  };
}
