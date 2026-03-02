import { describe, expect, it } from "vitest";
import {
  buildRequestSnapshotFiles,
  buildResponseSnapshotFiles,
  buildResponseTurnBundlePatch,
} from "./attempt.js";

describe("context snapshots (OC#4)", () => {
  it("request snapshot emits files/turn-bundle.json (phase=request)", () => {
    const files = buildRequestSnapshotFiles({
      turnId: "turn-123",
      provider: "openai",
      model: "gpt-test",
      prompt: "hello",
      messages: [
        { role: "user", content: "hi" },
      ] as unknown as import("@mariozechner/pi-agent-core").AgentMessage[],
    });

    expect(Object.keys(files)).toEqual(["files/turn-bundle.json"]);
    const parsed = JSON.parse(files["files/turn-bundle.json"]);
    expect(parsed.turn_id).toBe("turn-123");
    expect(parsed.phase).toBe("request");
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("gpt-test");
    expect(parsed.prompt).toBe("hello");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.stop_reason).toBeNull();
    expect(parsed.usage).toBeNull();
    expect(parsed.error).toBeNull();
  });

  it("response snapshot emits files/assistant-response.json (phase=response)", () => {
    const files = buildResponseSnapshotFiles({
      turnId: "turn-123",
      provider: "anthropic",
      model: "claude-test",
      prompt: "hello",
      messages: [
        { role: "user", content: "hi" },
      ] as unknown as import("@mariozechner/pi-agent-core").AgentMessage[],
      stopReason: "end_turn",
      usage: { input: 1, output: 2 },
      error: null,
      response: {
        role: "assistant",
        content: "ok",
      } as unknown as import("@mariozechner/pi-agent-core").AgentMessage,
      assistantTexts: ["ok"],
      providerResponseRaw: null,
    });

    expect(Object.keys(files)).toEqual(["files/assistant-response.json"]);
    const parsed = JSON.parse(files["files/assistant-response.json"]);
    expect(parsed.turn_id).toBe("turn-123");
    expect(parsed.phase).toBe("response");
    expect(parsed.stop_reason).toBe("end_turn");
    expect(parsed.usage).toEqual({ input: 1, output: 2 });
    expect(parsed.error).toBeNull();
  });

  it("response turn-bundle patch is minimal (response_summary only)", () => {
    const patch = buildResponseTurnBundlePatch({
      turnId: "turn-999",
      provider: "openai",
      model: "gpt-test",
      prompt: "hello",
      messages: [
        { role: "user", content: "hi" },
      ] as unknown as import("@mariozechner/pi-agent-core").AgentMessage[],
      stopReason: "end_turn",
      usage: { input: 1, output: 2 },
      error: null,
    });

    expect(Object.keys(patch)).toEqual(["files/turn-bundle.json"]);
    const parsed = JSON.parse(patch["files/turn-bundle.json"]);
    expect(parsed.turn_id).toBe("turn-999");
    expect(parsed.phase).toBe("response");
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("gpt-test");
    expect(parsed.prompt).toBe("hello");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.stop_reason).toBe("end_turn");
    expect(parsed.usage).toEqual({ input: 1, output: 2 });
    expect(parsed.error).toBeNull();
  });

  it("response snapshot can carry error for failure response", () => {
    const files = buildResponseSnapshotFiles({
      turnId: "turn-err",
      provider: "openai",
      model: "gpt-test",
      prompt: "hello",
      messages: [
        { role: "user", content: "hi" },
      ] as unknown as import("@mariozechner/pi-agent-core").AgentMessage[],
      stopReason: null,
      usage: null,
      error: "rate limit",
      response: null,
      assistantTexts: [],
      providerResponseRaw: null,
    });

    const parsed = JSON.parse(files["files/assistant-response.json"]);
    expect(parsed.turn_id).toBe("turn-err");
    expect(parsed.error).toBe("rate limit");
  });
});
