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

import createCronScheduler from "../../registry/scheduler/cron/index.js";

describe("scheduler-cron", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create scheduler with correct name", () => {
    const scheduler = createCronScheduler({});
    expect(scheduler.name).toBe("scheduler-cron");
  });

  it("should add a cron job and return an id", async () => {
    const scheduler = createCronScheduler({});
    const handler = vi.fn();

    const id = await scheduler.addJob({
      cron: "* * * * *",
      handler,
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should add a job with custom id", async () => {
    const scheduler = createCronScheduler({});
    const handler = vi.fn();

    const id = await scheduler.addJob({
      id: "my-job",
      cron: "* * * * *",
      handler,
    });

    expect(id).toBe("my-job");
  });

  it("should reject duplicate job ids", async () => {
    const scheduler = createCronScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "dup", cron: "* * * * *", handler });

    await expect(
      scheduler.addJob({ id: "dup", cron: "* * * * *", handler }),
    ).rejects.toThrow("already exists");
  });

  it("should reject invalid cron expressions", async () => {
    const scheduler = createCronScheduler({});

    await expect(
      scheduler.addJob({ cron: "not a cron", handler: vi.fn() }),
    ).rejects.toThrow("Invalid cron expression");
  });

  it("should list jobs", async () => {
    const scheduler = createCronScheduler({});

    await scheduler.addJob({ id: "job-1", cron: "* * * * *", handler: vi.fn() });
    await scheduler.addJob({ id: "job-2", interval: 5000, handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe("job-1");
    expect(jobs[0].type).toBe("cron");
    expect(jobs[1].id).toBe("job-2");
    expect(jobs[1].type).toBe("interval");
  });

  it("should remove a job", async () => {
    const scheduler = createCronScheduler({});

    await scheduler.addJob({ id: "removable", cron: "* * * * *", handler: vi.fn() });
    let jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);

    await scheduler.removeJob("removable");
    jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(0);
  });

  it("should start and stop without errors", async () => {
    const scheduler = createCronScheduler({});
    await scheduler.addJob({ cron: "* * * * *", handler: vi.fn() });

    await expect(scheduler.start()).resolves.toBeUndefined();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it("should execute interval jobs on start", async () => {
    const scheduler = createCronScheduler({});
    const handler = vi.fn();

    await scheduler.addJob({ id: "interval-job", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(3500);

    // handler should have been called ~3 times
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(3);

    await scheduler.stop();
  });

  it("should track job metadata", async () => {
    const scheduler = createCronScheduler({});

    await scheduler.addJob({
      id: "meta-job",
      cron: "* * * * *",
      handler: vi.fn(),
      metadata: { label: "test" },
    });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].metadata).toEqual({ label: "test" });
  });
});
