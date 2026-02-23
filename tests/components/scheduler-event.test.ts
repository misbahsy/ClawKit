import { describe, it, expect, vi } from "vitest";
import createEventScheduler from "../../registry/scheduler/event/index.js";

describe("scheduler-event", () => {
  it("should have correct name", () => {
    const scheduler = createEventScheduler({});
    expect(scheduler.name).toBe("scheduler-event");
  });

  it("should add an event job and return an id", async () => {
    const scheduler = createEventScheduler({});
    const id = await scheduler.addJob({
      event: "email:received",
      handler: vi.fn(),
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should add a job with custom id", async () => {
    const scheduler = createEventScheduler({});
    const id = await scheduler.addJob({
      id: "on-email",
      event: "email:received",
      handler: vi.fn(),
    });

    expect(id).toBe("on-email");
  });

  it("should reject duplicate job ids", async () => {
    const scheduler = createEventScheduler({});
    await scheduler.addJob({ id: "dup", event: "test", handler: vi.fn() });

    await expect(
      scheduler.addJob({ id: "dup", event: "test", handler: vi.fn() }),
    ).rejects.toThrow("already exists");
  });

  it("should require event name", async () => {
    const scheduler = createEventScheduler({});

    await expect(
      scheduler.addJob({ handler: vi.fn() }),
    ).rejects.toThrow("Event jobs require an event name");
  });

  it("should trigger handler on emit", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({
      id: "listener",
      event: "deploy",
      handler,
    });

    await scheduler.start();
    await scheduler.emit("deploy", { version: "1.0" });

    expect(handler).toHaveBeenCalled();
    const ctx = handler.mock.calls[0][0];
    expect(ctx.eventName).toBe("deploy");
    expect(ctx.eventData).toEqual({ version: "1.0" });
  });

  it("should not trigger handlers before start()", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({
      event: "test",
      handler,
    });

    const count = await scheduler.emit("test");
    expect(count).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("should not trigger handlers after stop()", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({ event: "test", handler });
    await scheduler.start();
    await scheduler.stop();

    const count = await scheduler.emit("test");
    expect(count).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("should trigger multiple handlers for same event", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    await scheduler.addJob({ id: "h1", event: "build", handler: handler1 });
    await scheduler.addJob({ id: "h2", event: "build", handler: handler2 });

    await scheduler.start();
    const count = await scheduler.emit("build");

    expect(count).toBe(2);
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should not trigger handlers for different events", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({ event: "deploy", handler });
    await scheduler.start();

    const count = await scheduler.emit("build");
    expect(count).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("should track runCount", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({ id: "counter", event: "tick", handler });
    await scheduler.start();

    await scheduler.emit("tick");
    await scheduler.emit("tick");
    await scheduler.emit("tick");

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBe(3);
  });

  it("should track lastRun", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({ id: "timed", event: "ping", handler });
    await scheduler.start();

    const before = new Date();
    await scheduler.emit("ping");

    const jobs = await scheduler.listJobs();
    expect(jobs[0].lastRun).toBeDefined();
    expect(jobs[0].lastRun!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("should list jobs with event type", async () => {
    const scheduler = createEventScheduler({});

    await scheduler.addJob({ id: "j1", event: "a", handler: vi.fn() });
    await scheduler.addJob({ id: "j2", event: "b", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].type).toBe("event");
    expect(jobs[0].schedule).toBe("on:a");
    expect(jobs[1].schedule).toBe("on:b");
  });

  it("should remove a job", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({ id: "removable", event: "test", handler });

    let jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);

    await scheduler.removeJob("removable");
    jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(0);

    // Emitting should not trigger removed handler
    await scheduler.start();
    await scheduler.emit("test");
    expect(handler).not.toHaveBeenCalled();
  });

  it("should silently handle removing non-existent job", async () => {
    const scheduler = createEventScheduler({});
    await expect(scheduler.removeJob("ghost")).resolves.toBeUndefined();
  });

  it("should enforce maxListeners", async () => {
    const scheduler = createEventScheduler({ maxListeners: 2 });

    await scheduler.addJob({ id: "j1", event: "a", handler: vi.fn() });
    await scheduler.addJob({ id: "j2", event: "b", handler: vi.fn() });

    await expect(
      scheduler.addJob({ id: "j3", event: "c", handler: vi.fn() }),
    ).rejects.toThrow("Maximum listener count");
  });

  it("should handle errors in event handlers gracefully", async () => {
    const scheduler = createEventScheduler({}) as any;
    const failingHandler = vi.fn().mockRejectedValue(new Error("oops"));
    const successHandler = vi.fn();

    await scheduler.addJob({ id: "failing", event: "test", handler: failingHandler });
    await scheduler.addJob({ id: "success", event: "test", handler: successHandler });

    await scheduler.start();
    const count = await scheduler.emit("test");

    // Both handlers should be attempted
    expect(count).toBe(2);
    expect(failingHandler).toHaveBeenCalled();
    expect(successHandler).toHaveBeenCalled();
  });

  it("should start and stop without errors", async () => {
    const scheduler = createEventScheduler({});
    await expect(scheduler.start()).resolves.toBeUndefined();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it("should initialize runCount to zero", async () => {
    const scheduler = createEventScheduler({});
    await scheduler.addJob({ id: "fresh", event: "test", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBe(0);
  });

  it("should pass data to handler via context", async () => {
    const scheduler = createEventScheduler({}) as any;
    const handler = vi.fn();

    await scheduler.addJob({ id: "data-check", event: "message", handler });
    await scheduler.start();

    await scheduler.emit("message", { text: "hello", from: "user1" });

    const ctx = handler.mock.calls[0][0];
    expect(ctx.eventData.text).toBe("hello");
    expect(ctx.eventData.from).toBe("user1");
    expect(ctx.jobId).toBe("data-check");
  });
});
