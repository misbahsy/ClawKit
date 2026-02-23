import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node-cron", () => ({
  default: {
    validate: vi.fn((expr: string) => /^[\d*\/,-]+(\s+[\d*\/,-]+){4}$/.test(expr)),
    schedule: vi.fn((_expr: string, _callback: Function, options?: any) => {
      const running = { value: options?.scheduled ?? true };
      return {
        start: vi.fn(() => { running.value = true; }),
        stop: vi.fn(() => { running.value = false; }),
      };
    }),
  },
}));

import createHeartbeatScheduler from "../../registry/scheduler/heartbeat/index.js";

describe("scheduler-heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create scheduler with correct name", () => {
    const scheduler = createHeartbeatScheduler({});
    expect(scheduler.name).toBe("scheduler-heartbeat");
  });

  it("should add a cron job and return an id", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    const id = await scheduler.addJob({
      cron: "* * * * *",
      handler,
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should add a job with custom id", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    const id = await scheduler.addJob({
      id: "morning-briefing",
      cron: "0 9 * * *",
      handler,
    });

    expect(id).toBe("morning-briefing");
  });

  it("should reject duplicate job ids", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "dup", cron: "* * * * *", handler });

    await expect(
      scheduler.addJob({ id: "dup", cron: "* * * * *", handler }),
    ).rejects.toThrow("already exists");
  });

  it("should require cron or interval", async () => {
    const scheduler = createHeartbeatScheduler({});

    await expect(
      scheduler.addJob({ handler: vi.fn() }),
    ).rejects.toThrow("Heartbeat jobs require cron or interval");
  });

  it("should list jobs", async () => {
    const scheduler = createHeartbeatScheduler({});

    await scheduler.addJob({ id: "job-1", cron: "* * * * *", handler: vi.fn() });
    await scheduler.addJob({ id: "job-2", interval: 5000, handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe("job-1");
    expect(jobs[0].type).toBe("cron");
    expect(jobs[1].id).toBe("job-2");
    expect(jobs[1].type).toBe("interval");
  });

  it("should show schedule string for cron jobs", async () => {
    const scheduler = createHeartbeatScheduler({});

    await scheduler.addJob({ id: "cron-job", cron: "0 9 * * *", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].schedule).toBe("0 9 * * *");
  });

  it("should show schedule string for interval jobs", async () => {
    const scheduler = createHeartbeatScheduler({});

    await scheduler.addJob({ id: "int-job", interval: 60000, handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].schedule).toBe("every 60000ms");
  });

  it("should remove a job", async () => {
    const scheduler = createHeartbeatScheduler({});

    await scheduler.addJob({ id: "removable", cron: "* * * * *", handler: vi.fn() });
    let jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);

    await scheduler.removeJob("removable");
    jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(0);
  });

  it("should silently handle removing non-existent job", async () => {
    const scheduler = createHeartbeatScheduler({});
    await expect(scheduler.removeJob("ghost")).resolves.toBeUndefined();
  });

  it("should start and stop without errors", async () => {
    const scheduler = createHeartbeatScheduler({});
    await scheduler.addJob({ cron: "* * * * *", handler: vi.fn() });

    await expect(scheduler.start()).resolves.toBeUndefined();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it("should execute interval jobs on start", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "interval-job", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(3500);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3);

    await scheduler.stop();
  });

  it("should track runCount for interval jobs", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "counter-job", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(3500);

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBeGreaterThanOrEqual(3);

    await scheduler.stop();
  });

  it("should start jobs added after start() is called", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    await scheduler.start();
    await scheduler.addJob({ id: "late-job", interval: 1000, handler });

    vi.advanceTimersByTime(2500);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);

    await scheduler.stop();
  });

  it("should not execute interval jobs before start", async () => {
    const scheduler = createHeartbeatScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "pending-job", interval: 1000, handler });

    vi.advanceTimersByTime(3000);

    expect(handler).not.toHaveBeenCalled();
  });

  it("should initialize runCount to zero", async () => {
    const scheduler = createHeartbeatScheduler({});

    await scheduler.addJob({ id: "fresh-job", cron: "* * * * *", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBe(0);
  });
});
