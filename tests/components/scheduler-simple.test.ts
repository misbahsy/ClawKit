import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createSimpleScheduler from "../../registry/scheduler/simple/index.js";

describe("scheduler-simple", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have the correct name", () => {
    const scheduler = createSimpleScheduler({});
    expect(scheduler.name).toBe("scheduler-simple");
  });

  it("should throw on cron expressions", async () => {
    const scheduler = createSimpleScheduler({});

    await expect(
      scheduler.addJob({ cron: "* * * * *", handler: vi.fn() }),
    ).rejects.toThrow("does not support cron");
  });

  it("should add an interval job and return an id", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    const id = await scheduler.addJob({ interval: 1000, handler });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should add a job with custom id", async () => {
    const scheduler = createSimpleScheduler({});

    const id = await scheduler.addJob({
      id: "my-interval-job",
      interval: 5000,
      handler: vi.fn(),
    });

    expect(id).toBe("my-interval-job");
  });

  it("should reject duplicate job ids", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "dup", interval: 1000, handler });

    await expect(
      scheduler.addJob({ id: "dup", interval: 2000, handler }),
    ).rejects.toThrow("already exists");
  });

  it("should reject jobs with neither interval nor once", async () => {
    const scheduler = createSimpleScheduler({});

    await expect(
      scheduler.addJob({ handler: vi.fn() }),
    ).rejects.toThrow("must have either interval or once");
  });

  it("should execute interval jobs after start", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "interval-1", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(3500);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3);

    await scheduler.stop();
  });

  it("should execute once jobs at scheduled time", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    const future = new Date(Date.now() + 2000);
    await scheduler.addJob({ id: "once-1", once: future, handler });
    await scheduler.start();

    vi.advanceTimersByTime(1000);
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    expect(handler).toHaveBeenCalledTimes(1);

    await scheduler.stop();
  });

  it("should not execute once jobs that are in the past", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    const past = new Date(Date.now() - 1000);
    await scheduler.addJob({ id: "past-1", once: past, handler });
    await scheduler.start();

    vi.advanceTimersByTime(5000);
    expect(handler).not.toHaveBeenCalled();

    await scheduler.stop();
  });

  it("should list jobs", async () => {
    const scheduler = createSimpleScheduler({});

    await scheduler.addJob({ id: "j1", interval: 5000, handler: vi.fn() });
    await scheduler.addJob({
      id: "j2",
      once: new Date(Date.now() + 10000),
      handler: vi.fn(),
    });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe("j1");
    expect(jobs[0].type).toBe("interval");
    expect(jobs[0].schedule).toBe("every 5000ms");
    expect(jobs[1].id).toBe("j2");
    expect(jobs[1].type).toBe("once");
  });

  it("should remove a job", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "removable", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(2500);
    const countBefore = handler.mock.calls.length;

    await scheduler.removeJob("removable");

    vi.advanceTimersByTime(5000);
    expect(handler.mock.calls.length).toBe(countBefore);

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(0);

    await scheduler.stop();
  });

  it("should track run counts", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "counter", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(3500);

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBeGreaterThanOrEqual(3);

    await scheduler.stop();
  });

  it("should track job metadata", async () => {
    const scheduler = createSimpleScheduler({});

    await scheduler.addJob({
      id: "meta-job",
      interval: 1000,
      handler: vi.fn(),
      metadata: { label: "test" },
    });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].metadata).toEqual({ label: "test" });
  });

  it("should start and stop without errors", async () => {
    const scheduler = createSimpleScheduler({});
    await scheduler.addJob({ interval: 1000, handler: vi.fn() });

    await expect(scheduler.start()).resolves.toBeUndefined();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it("should clear timers on stop", async () => {
    const scheduler = createSimpleScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "s1", interval: 100, handler });
    await scheduler.start();

    vi.advanceTimersByTime(350);
    const countBeforeStop = handler.mock.calls.length;

    await scheduler.stop();

    vi.advanceTimersByTime(1000);
    expect(handler.mock.calls.length).toBe(countBeforeStop);
  });

  it("should handle removing nonexistent job gracefully", async () => {
    const scheduler = createSimpleScheduler({});
    await expect(scheduler.removeJob("nonexistent")).resolves.toBeUndefined();
  });
});
