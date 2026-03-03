import { describe, expect, it } from "vitest";
import {
  buildRequestSnapshotFiles,
  buildResponseSnapshotFiles,
  buildResponseTurnBundlePatch,
} from "./attempt.js";

describe("context snapshots (OC#4)", () => {
  it("request snapshot emits turn-bundle.json (phase=request)", () => {
    const files = buildRequestSnapshotFiles({
      turnId: "turn-123",
      provider: "openai",
      model: "gpt-test",
      prompt: "hello",
      messages: [
        { role: "user", content: "hi" },
      ] as unknown as import("@mariozechner/pi-agent-core").AgentMessage[],
    });

    expect(Object.keys(files)).toEqual(["turn-bundle.json"]);
    const parsed = JSON.parse(files["turn-bundle.json"]);
    expect(parsed.turn_id).toBe("turn-123");
    expect(parsed.wake_event_id).toBeNull();
    expect(parsed.phase).toBe("request");
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toBe("gpt-test");
    expect(parsed.prompt).toBe("hello");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.stop_reason).toBeNull();
    expect(parsed.usage).toBeNull();
    expect(parsed.error).toBeNull();
  });

  it("request snapshot canonicalizes tool call IDs for stability", () => {
    const files = buildRequestSnapshotFiles({
      turnId: "turn-124",
      provider: "openai",
      model: "gpt-test",
      prompt: "hello",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "toolu_01TxQJVz", name: "exec", arguments: {} },
            { type: "toolResult", toolCallId: "toolu_01TxQJVz", result: "ok" },
          ],
        },
      ] as unknown as import("@mariozechner/pi-agent-core").AgentMessage[],
    });

    const parsed = JSON.parse(files["turn-bundle.json"]);
    const blocks = parsed.messages[0].content;
    expect(blocks[0].id).toBe("toolu_01TxQJVz");
    expect(blocks[0].id_norm).toBe("toolu01TxQJVz");
    expect(blocks[1].toolCallId).toBe("toolu_01TxQJVz");
    expect(blocks[1].toolCallId_norm).toBe("toolu01TxQJVz");
  });

  it("response snapshot emits assistant-response.json (phase=response)", () => {
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

    expect(Object.keys(files)).toEqual(["assistant-response.json"]);
    const parsed = JSON.parse(files["assistant-response.json"]);
    expect(parsed.turn_id).toBe("turn-123");
    expect(parsed.phase).toBe("response");
    expect(parsed.stop_reason).toBe("end_turn");
    expect(parsed.usage).toEqual({ input: 1, output: 2 });
    expect(parsed.error).toBeNull();
  });

  it("response turn-bundle patch carries wake_event_id when provided", () => {
    const patch = buildResponseTurnBundlePatch({
      turnId: "turn-999",
      wakeEventId: "01JWH1J0Y9K8KXJ7SKYTDK6V6W",
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

    expect(Object.keys(patch)).toEqual(["turn-bundle.json"]);
    const parsed = JSON.parse(patch["turn-bundle.json"]);
    expect(parsed.turn_id).toBe("turn-999");
    expect(parsed.wake_event_id).toBe("01JWH1J0Y9K8KXJ7SKYTDK6V6W");
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

    const parsed = JSON.parse(files["assistant-response.json"]);
    expect(parsed.turn_id).toBe("turn-err");
    expect(parsed.error).toBe("rate limit");
  });
});
