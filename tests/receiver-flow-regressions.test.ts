import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpticalProfileId, VisualPhyId } from "../src/protocol/optical-profile";
import { OpticalTransferEncoder } from "../src/sender/transport";

type ElementProps = Record<string, unknown> & { children?: ReactNode };
type TestElement = ReactElement<ElementProps>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

const rig = vi.hoisted(() => ({
  state: [] as unknown[],
  stateCursor: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
  memos: [] as unknown[],
  memoCursor: 0,
  decodeQueue: [] as Array<{ promise: Promise<unknown> }>,
  decodeUrls: [] as string[],
  workerPools: [] as Array<{
    stopped: boolean;
    emit(result: unknown): void;
  }>,
  ingestDecodedQr: vi.fn(),
  verifyAgxEnvelope: vi.fn(),
  evaluateBrowserPolicy: vi.fn(),
  measureTransport: vi.fn(),
  unpackOpticalPayload: vi.fn(),
  assertFreshTransfer: vi.fn(),
  share: vi.fn(),
  trust: {
    pairingVersion: "4" as const,
    publicKey: new Uint8Array(32).fill(7),
    boundary: "demo/phone-laptop",
    sessionId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
    profileId: "grid" as OpticalProfileId,
    packing: "identity" as const,
    visualPhy: "mono-grid-v0" as VisualPhyId,
    targetSymbolRate: 30,
  },
  verifiedTransfer: {
    payload: new TextEncoder().encode("verified payload"),
    filename: "verified.txt",
    mediaType: "text/plain",
    payloadSha256: "11".repeat(32),
    signerKeyId: "sender-test-key",
    envelopeId: "envelope-test-id",
    boundary: "demo/phone-laptop",
    purpose: "controlled-file-import",
    policyId: "glassbridge-browser-demo-v1",
    policyDigest: "22".repeat(32),
    sequence: 1,
    createdUnix: 1_700_000_000,
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useMemo<T>(factory: () => T) {
      const index = rig.memoCursor;
      rig.memoCursor += 1;
      if (!(index in rig.memos)) rig.memos[index] = factory();
      return rig.memos[index] as T;
    },
    useRef<T>(initial: T) {
      const index = rig.refCursor;
      rig.refCursor += 1;
      if (!(index in rig.refs)) rig.refs[index] = { current: initial };
      return rig.refs[index] as { current: T };
    },
    useState<T>(initial: T | (() => T)) {
      const index = rig.stateCursor;
      rig.stateCursor += 1;
      if (!(index in rig.state)) {
        rig.state[index] = typeof initial === "function"
          ? (initial as () => T)()
          : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        rig.state[index] = typeof next === "function"
          ? (next as (previous: T) => T)(rig.state[index] as T)
          : next;
      };
      return [rig.state[index] as T, setState] as const;
    },
  };
});

vi.mock("../src/receiver/agx", () => ({
  parseBootstrapHash: () => rig.trust,
  trustFingerprint: async () => "test-fingerprint",
  verifyAgxEnvelope: (...args: unknown[]) => rig.verifyAgxEnvelope(...args),
}));

vi.mock("../src/receiver/policy", () => ({
  evaluateBrowserPolicy: (...args: unknown[]) => rig.evaluateBrowserPolicy(...args),
}));

vi.mock("../src/receiver/qr-result", () => ({
  ingestDecodedQr: (...args: unknown[]) => rig.ingestDecodedQr(...args),
}));

vi.mock("../src/receiver/capacity-measurement", () => ({
  measureTransport: (...args: unknown[]) => rig.measureTransport(...args),
}));

vi.mock("../src/protocol/optical-payload", () => ({
  unpackOpticalPayload: (...args: unknown[]) => rig.unpackOpticalPayload(...args),
}));

vi.mock("../src/receiver/replay", () => ({
  assertFreshTransfer: (...args: unknown[]) => rig.assertFreshTransfer(...args),
  reserveTransferRelease: vi.fn(),
}));

vi.mock("../src/receiver/decode-worker-pool", () => {
  class TestDecodeWorkerPool {
    readonly size: number;
    busyCount = 0;
    stopped = false;

    constructor(size: number, private readonly onResult: (result: unknown) => void) {
      this.size = size;
      rig.workerPools.push(this);
    }

    submit(): boolean {
      return !this.stopped;
    }

    stop(): void {
      this.stopped = true;
    }

    emit(result: unknown): void {
      this.onResult(result);
    }
  }

  return {
    DecodeWorkerPool: TestDecodeWorkerPool,
    replaceDecodeWorkerPool(
      current: TestDecodeWorkerPool,
      create: () => TestDecodeWorkerPool,
      onFailure: (error: unknown) => void,
    ) {
      current.stop();
      try {
        return create();
      } catch (error) {
        onFailure(error);
        return undefined;
      }
    },
  };
});

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromImageUrl(url: string): Promise<unknown> {
      rig.decodeUrls.push(url);
      const next = rig.decodeQueue.shift();
      if (!next) return Promise.reject(new Error("No queued saved-frame decode result."));
      return next.promise;
    }
  },
}));

import ReceiverApp from "../src/receiver/ReceiverApp";

describe("receiver flow regressions", () => {
  beforeEach(() => {
    rig.state.length = 0;
    rig.refs.length = 0;
    rig.memos.length = 0;
    rig.decodeQueue.length = 0;
    rig.decodeUrls.length = 0;
    rig.workerPools.length = 0;
    rig.trust.profileId = "grid";
    rig.trust.visualPhy = "mono-grid-v0";
    rig.trust.targetSymbolRate = 30;
    resetHookCursors();
    vi.clearAllMocks();

    rig.ingestDecodedQr.mockImplementation((_result, decoder) => (
      decoder as { ingestText(value: string): unknown }
    ).ingestText("invalid-frame"));
    rig.verifyAgxEnvelope.mockResolvedValue(rig.verifiedTransfer);
    rig.evaluateBrowserPolicy.mockResolvedValue({
      allowed: true,
      code: "GB-ALLOW",
      reason: "test policy allowed",
      evaluatedUnix: 1_700_000_001,
      expectedPolicyDigest: rig.verifiedTransfer.policyDigest,
    });
    rig.measureTransport.mockReturnValue({});
    rig.unpackOpticalPayload.mockImplementation(async (bytes: Uint8Array) => ({
      bytes,
      encoding: "identity",
      originalBytes: bytes.length,
      transmittedBytes: bytes.length,
    }));

    const sessionStorage = memoryStorage();
    const localStorage = memoryStorage();
    vi.stubGlobal("window", {
      location: {
        hash: "#paired",
        pathname: "/receive.html",
        search: "",
        reload: vi.fn(),
      },
      history: { replaceState: vi.fn() },
      sessionStorage,
      localStorage,
      isSecureContext: true,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 4,
      userAgent: "GlassBridge deterministic receiver test",
      mediaDevices: { getUserMedia: vi.fn(async () => fakeStream()) },
      canShare: vi.fn(() => true),
      share: rig.share,
    });
    vi.stubGlobal("document", {
      createElement: vi.fn((name: string) => {
        if (name === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({
              drawImage: vi.fn(),
              getImageData: () => ({
                data: new Uint8ClampedArray(4),
                width: 1,
                height: 1,
              }),
            }),
          };
        }
        return { click: vi.fn(), remove: vi.fn() };
      }),
      body: { append: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels a stopped saved-frame run and prevents its late result from contaminating the next run", async () => {
    const staleDecode = deferred<unknown>();
    const currentDecode = deferred<unknown>();
    rig.decodeQueue.push(staleDecode, currentDecode);

    let tree = renderReceiver();
    selectSavedFrames(tree, [pngFile("stale.png")]);
    await vi.waitFor(() => expect(rig.decodeUrls).toHaveLength(1));

    tree = renderReceiver();
    click(buttonWithText(tree, "Stop scanning"));
    tree = renderReceiver();
    click(buttonWithText(tree, "Return to paired receiver"));

    tree = renderReceiver();
    selectSavedFrames(tree, [pngFile("current.png")]);
    await vi.waitFor(() => expect(rig.decodeUrls).toHaveLength(2));

    const staleResult = { run: "stale" };
    staleDecode.resolve(staleResult);
    await flushPromises();

    tree = renderReceiver();
    expect(textOf(tree)).toContain("RECONSTRUCTION");
    expect(rig.ingestDecodedQr).not.toHaveBeenCalledWith(staleResult, expect.anything());

    const currentResult = { run: "current" };
    currentDecode.resolve(currentResult);
    await vi.waitFor(() => expect(rig.ingestDecodedQr).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(textOf(renderReceiver())).toContain("Not enough independent frames");
    });
    expect(rig.ingestDecodedQr).toHaveBeenCalledWith(currentResult, expect.anything());
  });

  it("turns an operator stop into a fail-closed, exportable saved-frame result", async () => {
    rig.decodeQueue.push(deferred<unknown>());
    let tree = renderReceiver();
    selectSavedFrames(tree, [pngFile("pending.png")]);
    await vi.waitFor(() => expect(rig.decodeUrls).toHaveLength(1));

    tree = renderReceiver();
    click(buttonWithText(tree, "Stop scanning"));
    tree = renderReceiver();

    expect(textOf(tree)).toContain("Nothing was released.");
    expect(textOf(tree)).toContain("Operator stopped saved-frame decoding before verification.");
    click(buttonWithText(tree, "Save / share failure diagnostics"));

    await vi.waitFor(() => expect(rig.share).toHaveBeenCalledTimes(1));
    const report = await sharedJson();
    expect(report).toMatchObject({
      schema: "glassbridge-device-run/1",
      outcome: "failed",
      source_mode: "saved-frames",
      failure_class: "operator-or-environment-error",
      reason: "Operator stopped saved-frame decoding before verification.",
    });
  });

  it("reports a CRC-invalid Grid code as rejected acquisition, never as a valid decode", async () => {
    let tree = await startCameraReceiver();
    const encoder = gridEncoder(new Uint8Array(64).fill(5));
    const corrupt = encoder.frameBytes(0);
    corrupt[corrupt.length - 1] ^= 1;

    rig.workerPools[0].emit({
      id: 1,
      decodeMs: 2,
      codes: [{ bytes: corrupt }],
      grid: {
        outcome: "decoded",
        markersFound: true,
        registrationReused: true,
        transportValid: false,
        reacquiredSameFrame: true,
      },
    });

    tree = renderReceiver();
    click(buttonWithText(tree, "Stop scanning"));
    tree = renderReceiver();
    click(buttonWithText(tree, "Save / share failure diagnostics"));

    await vi.waitFor(() => expect(rig.share).toHaveBeenCalledTimes(1));
    const report = await sharedJson();
    expect(report.progress).toMatchObject({
      accepted_frames: 0,
      rejected_frames: 1,
    });
    expect(report.camera).toMatchObject({
      decode_jobs: 1,
      successful_decode_jobs: 0,
      empty_decode_jobs: 1,
      optical_acquisition_percent: 0,
      same_frame_reacquisitions: 1,
      same_frame_reacquisition_successes: 0,
    });
  });

  it("does not let the stationary pairing QR exhaust the transport rejection budget", async () => {
    rig.trust.profileId = "burst";
    rig.trust.visualPhy = "qr-model2-v1";
    rig.trust.targetSymbolRate = 60;
    await startCameraReceiver();
    const pairingUrl = "https://glassbridge.test/receive.html#v=4&key=pairing";
    const pairingBytes = new TextEncoder().encode(pairingUrl);

    for (let index = 0; index < 200; index += 1) {
      rig.workerPools[0].emit({
        id: index,
        decodeMs: 1,
        codes: [{ bytes: pairingBytes.slice(), text: pairingUrl }],
      });
    }

    let tree = renderReceiver();
    expect(textOf(tree)).toContain("RECONSTRUCTION");
    expect(textOf(tree)).not.toContain("Nothing was released.");
    expect(rig.workerPools[0].stopped).toBe(false);

    const encoder = new OpticalTransferEncoder(new Uint8Array(64).fill(9), {
      sessionId: rig.trust.sessionId,
      symbolSize: 1_688,
      codec: "lt-v2",
    });
    const corrupt = encoder.frameBytes(0);
    corrupt[corrupt.length - 1] ^= 1;
    for (let index = 0; index < 180; index += 1) {
      rig.workerPools[0].emit({
        id: 200 + index,
        decodeMs: 1,
        codes: [{ bytes: corrupt.slice() }],
      });
    }

    tree = renderReceiver();
    expect(textOf(tree)).toContain("Nothing was released.");
    expect(textOf(tree)).toContain("no intact GlassBridge frame survived");
    expect(rig.workerPools[0].stopped).toBe(true);
  });

  it("routes a live legacy text QR through base64 decoding instead of binary parsing", async () => {
    rig.trust.profileId = "legacy";
    rig.trust.visualPhy = "qr-model2-v1";
    rig.trust.targetSymbolRate = 4;
    await startCameraReceiver();
    const encoder = new OpticalTransferEncoder(
      new TextEncoder().encode("legacy live optical envelope"),
      {
        sessionId: rig.trust.sessionId,
        symbolSize: 512,
        codec: "dense-v1",
      },
    );
    const text = encoder.frameText(0);

    rig.workerPools[0].emit({
      id: 400,
      decodeMs: 1,
      codes: [{ bytes: new TextEncoder().encode(text), text }],
    });

    await vi.waitFor(() => expect(rig.verifyAgxEnvelope).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(textOf(renderReceiver())).toContain("Verified. Held for approval.");
    });
  });

  it("reaches verified quarantine even when optional benchmark analytics throw", async () => {
    await startCameraReceiver();
    rig.measureTransport.mockImplementationOnce(() => {
      throw new Error("synthetic analytics failure");
    });
    const encoder = gridEncoder(new TextEncoder().encode("one-source optical envelope"));

    rig.workerPools[0].emit({
      id: 2,
      decodeMs: 2,
      codes: [{ bytes: encoder.frameBytes(0) }],
      grid: {
        outcome: "decoded",
        markersFound: true,
        registrationReused: false,
        transportValid: true,
      },
    });

    await vi.waitFor(() => expect(rig.verifyAgxEnvelope).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      const text = textOf(renderReceiver());
      expect(text).toContain("Verified. Held for approval.");
      expect(text).not.toContain("Nothing was released.");
    });
    expect(rig.measureTransport).toHaveBeenCalledTimes(1);
    expect(rig.workerPools[0].stopped).toBe(true);
  });
});

async function startCameraReceiver(): Promise<TestElement> {
  let tree = renderReceiver();
  rig.refs[0].current = fakeVideo();
  click(buttonWithText(tree, "Trust sender & open camera"));
  await vi.waitFor(() => expect(rig.workerPools).toHaveLength(1));
  tree = renderReceiver();
  expect(textOf(tree)).toContain("RECONSTRUCTION");
  return tree;
}

function gridEncoder(payload: Uint8Array): OpticalTransferEncoder {
  return new OpticalTransferEncoder(payload, {
    sessionId: rig.trust.sessionId,
    symbolSize: 2_032,
    frameCount: 1,
    codec: "lt-v2",
  });
}

function renderReceiver(): TestElement {
  resetHookCursors();
  return ReceiverApp() as TestElement;
}

function resetHookCursors(): void {
  rig.stateCursor = 0;
  rig.refCursor = 0;
  rig.memoCursor = 0;
}

function elements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  return [element, ...elements(element.props.children)];
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return textOf((node as TestElement).props.children);
}

function buttonWithText(tree: ReactNode, label: string): TestElement {
  const button = elements(tree).find((element) => (
    element.type === "button" && textOf(element).includes(label)
  ));
  expect(button, `missing button containing ${label}`).toBeDefined();
  return button!;
}

function click(element: TestElement): void {
  const onClick = element.props.onClick as (() => void) | undefined;
  expect(onClick).toBeTypeOf("function");
  onClick!();
}

function selectSavedFrames(tree: ReactNode, files: File[]): void {
  const input = elements(tree).find((element) => (
    element.type === "input" && element.props.type === "file"
  ));
  expect(input, "missing saved-frame file input").toBeDefined();
  const fileList = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;
  const onChange = input!.props.onChange as (event: unknown) => void;
  onChange({ currentTarget: { files: fileList } });
}

function pngFile(name: string): File {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
  ]);
  return new File([bytes], name, { type: "image/png" });
}

function fakeVideo(): HTMLVideoElement {
  return {
    videoWidth: 1_280,
    videoHeight: 720,
    currentTime: 0,
    srcObject: null,
    play: vi.fn(async () => undefined),
    requestVideoFrameCallback: vi.fn(() => 17),
    cancelVideoFrameCallback: vi.fn(),
  } as unknown as HTMLVideoElement;
}

function fakeStream(): MediaStream {
  const track = {
    stop: vi.fn(),
    getSettings: () => ({ width: 1_280, height: 720, frameRate: 60 }),
  } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function sharedJson(): Promise<Record<string, any>> {
  const call = rig.share.mock.calls[0]?.[0] as { files?: File[] } | undefined;
  expect(call?.files).toHaveLength(1);
  return JSON.parse(await call!.files![0].text()) as Record<string, any>;
}
