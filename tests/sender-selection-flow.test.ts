import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateCursor: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useRef<T>(initial: T) {
      const index = hooks.refCursor;
      hooks.refCursor += 1;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useState<T>(initial: T | (() => T)) {
      const index = hooks.stateCursor;
      hooks.stateCursor += 1;
      if (!(index in hooks.state)) {
        hooks.state[index] = typeof initial === "function"
          ? (initial as () => T)()
          : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        hooks.state[index] = typeof next === "function"
          ? (next as (previous: T) => T)(hooks.state[index] as T)
          : next;
      };
      return [hooks.state[index] as T, setState] as const;
    },
  };
});

import SenderApp from "../src/sender/SenderApp";

type ElementProps = Record<string, unknown> & { children?: ReactNode };
type TestElement = ReactElement<ElementProps>;

describe("sender file and profile selection flow", () => {
  beforeEach(() => {
    hooks.state.length = 0;
    hooks.refs.length = 0;
    hooks.stateCursor = 0;
    hooks.refCursor = 0;
    vi.stubGlobal("window", {
      location: { origin: "https://glassbridge.test" },
      innerHeight: 720,
      innerWidth: 1_280,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues the 144 KiB sample, permits Grid 30 selection, then binds Grid in pairing", async () => {
    let tree = renderSender();
    click(buttonWithText(tree, "Load 144 KiB test payload"));

    tree = renderSender();
    expect(textOf(tree)).toContain("glassbridge-capacity-144k.bin");
    expect(buttonWithText(tree, "Grid 30 lab").props["aria-pressed"]).toBe(false);
    expect(buttonWithText(tree, "Prepare secure transfer")).toBeDefined();
    expect(pairingCanvas(tree)).toBeUndefined();
    expect((hooks.state[0] as File).size).toBe(144 * 1_024);
    expect(hooks.state[2]).toBeUndefined();
    expect(hooks.state[3]).toBe("choose");

    click(buttonWithText(tree, "Grid 30 lab"));
    tree = renderSender();
    expect(buttonWithText(tree, "Grid 30 lab").props["aria-pressed"]).toBe(true);
    expect(hooks.state[5]).toBe("grid");
    expect(hooks.state[6]).toBe(30);

    click(buttonWithText(tree, "Prepare secure transfer"));
    await vi.waitFor(() => expect(hooks.state[3]).toBe("pair"), { timeout: 5_000 });
    tree = renderSender();

    expect(pairingCanvas(tree)).toBeDefined();
    const prepared = hooks.state[2] as { pairing: string; profile: { id: string; visualPhy: string } };
    expect(prepared.profile.id).toBe("grid");
    expect(prepared.profile.visualPhy).toBe("mono-grid-v0");
    const pairing = new URL(prepared.pairing);
    const pairingParameters = new URLSearchParams(pairing.hash.slice(1));
    expect(pairingParameters.get("profile")).toBe("grid");
    expect(pairingParameters.get("phy")).toBe("mono-grid-v0");
    expect(pairingParameters.get("rate")).toBe("30");
  });

  it("shows the same profile chooser after a normal file selection", () => {
    let tree = renderSender();
    const fileInput = elements(tree).find((element) => (
      element.type === "input" && element.props.type === "file"
    ));
    expect(fileInput).toBeDefined();

    const selected = new File(["normal file\n"], "normal.txt", { type: "text/plain" });
    const onChange = fileInput!.props.onChange as (event: unknown) => void;
    onChange({ currentTarget: { files: { item: () => selected } } });

    tree = renderSender();
    expect(textOf(tree)).toContain("normal.txt");
    expect(buttonWithText(tree, "Grid 30 lab")).toBeDefined();
    expect(buttonWithText(tree, "Prepare secure transfer")).toBeDefined();
    expect(pairingCanvas(tree)).toBeUndefined();
    expect(hooks.state[3]).toBe("choose");
  });

  it("rejects an empty file before exposing transfer settings or pairing", () => {
    let tree = renderSender();
    const fileInput = elements(tree).find((element) => (
      element.type === "input" && element.props.type === "file"
    ));
    const onChange = fileInput!.props.onChange as (event: unknown) => void;
    onChange({ currentTarget: { files: { item: () => new File([], "empty.bin") } } });

    tree = renderSender();
    expect(textOf(tree)).toContain("Choose a non-empty file to send.");
    expect(textOf(tree)).toContain("There is nothing to send.");
    expect(pairingCanvas(tree)).toBeUndefined();
    expect(hooks.state[0]).toBeUndefined();
    expect(hooks.state[3]).toBe("choose");
  });

  it("cannot let a stale preparation replace a newly selected file", async () => {
    let resolveFirstRead: (bytes: ArrayBuffer) => void = () => undefined;
    const firstRead = new Promise<ArrayBuffer>((resolve) => { resolveFirstRead = resolve; });
    const first = new File(["first"], "first.txt", { type: "text/plain" });
    Object.defineProperty(first, "arrayBuffer", { value: () => firstRead });
    const second = new File(["second"], "second.txt", { type: "text/plain" });

    let tree = renderSender();
    const initialInput = fileInput(tree);
    changeFile(initialInput, first);

    tree = renderSender();
    const staleInputHandler = initialInputHandler(fileInput(tree));
    click(buttonWithText(tree, "Prepare secure transfer"));

    tree = renderSender();
    expect(fileInput(tree).props.disabled).toBe(true);
    expect(hooks.state[3]).toBe("preparing");

    // Model an already queued browser change event from the previous render.
    staleInputHandler({ currentTarget: { files: { item: () => second } } });
    resolveFirstRead(new TextEncoder().encode("first").buffer);
    await new Promise((resolve) => setTimeout(resolve, 0));

    tree = renderSender();
    expect(textOf(tree)).toContain("second.txt");
    expect(hooks.state[0]).toBe(second);
    expect(hooks.state[2]).toBeUndefined();
    expect(hooks.state[3]).toBe("choose");
    expect(pairingCanvas(tree)).toBeUndefined();
  });
});

function renderSender(): TestElement {
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  return SenderApp() as TestElement;
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

function pairingCanvas(tree: ReactNode): TestElement | undefined {
  return elements(tree).find((element) => (
    element.type === "canvas" && element.props["aria-label"] === "Phone pairing QR"
  ));
}

function fileInput(tree: ReactNode): TestElement {
  const input = elements(tree).find((element) => (
    element.type === "input" && element.props.type === "file"
  ));
  expect(input).toBeDefined();
  return input!;
}

function initialInputHandler(input: TestElement): (event: unknown) => void {
  const onChange = input.props.onChange as ((event: unknown) => void) | undefined;
  expect(onChange).toBeTypeOf("function");
  return onChange!;
}

function changeFile(input: TestElement, file: File): void {
  initialInputHandler(input)({ currentTarget: { files: { item: () => file } } });
}
