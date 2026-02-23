import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

import createPersistentScheduler from "../../registry/scheduler/persistent/index.js";

describe("scheduler-persistent", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawkit-persistent-scheduler-"));
    dbPath = join(tmpDir, "test-scheduler.db");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("should create scheduler with correct name", () => {
    const scheduler = createPersistentScheduler({ dbPath });
    expect(scheduler.name).toBe("scheduler-persistent");
  });

  it("should add a job and return an id", async () => {
    const scheduler = createPersistentScheduler({ dbPath });
    const handler = vi.fn();

    const id = await scheduler.addJob({
      cron: "* * * * *",
      handler,
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should add a job with custom id", async () => {
    const scheduler = createPersistentScheduler({ dbPath });
    const handler = vi.fn();

    const id = await scheduler.addJob({
      id: "daily-report",
      cron: "0 9 * * *",
      handler,
    });

    expect(id).toBe("daily-report");
  });

  it("should persist job to SQLite database", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({
      id: "persisted-job",
      cron: "0 8 * * *",
      handler: vi.fn(),
    });

    // Create a second scheduler instance pointing to same DB to verify persistence
    const scheduler2 = createPersistentScheduler({ dbPath });
    const jobs = await scheduler2.listJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("persisted-job");
    expect(jobs[0].type).toBe("cron");
    expect(jobs[0].schedule).toBe("0 8 * * *");
  });

  it("should list jobs from the database", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({ id: "job-a", cron: "* * * * *", handler: vi.fn() });
    await scheduler.addJob({ id: "job-b", interval: 5000, handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(2);

    const jobA = jobs.find(j => j.id === "job-a");
    const jobB = jobs.find(j => j.id === "job-b");

    expect(jobA).toBeDefined();
    expect(jobA!.type).toBe("cron");
    expect(jobA!.schedule).toBe("* * * * *");

    expect(jobB).toBeDefined();
    expect(jobB!.type).toBe("interval");
    expect(jobB!.schedule).toBe("5000");
  });

  it("should remove a job from the database", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({ id: "removable", cron: "* * * * *", handler: vi.fn() });
    let jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);

    await scheduler.removeJob("removable");
    jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(0);

    // Verify removal persists in a new instance
    const scheduler2 = createPersistentScheduler({ dbPath });
    const jobs2 = await scheduler2.listJobs();
    expect(jobs2).toHaveLength(0);
  });

  it("should start and stop without errors", async () => {
    const scheduler = createPersistentScheduler({ dbPath });
    await scheduler.addJob({ cron: "* * * * *", handler: vi.fn() });

    await expect(scheduler.start()).resolves.toBeUndefined();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it("should persist metadata as JSON", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({
      id: "meta-job",
      cron: "0 9 * * 1",
      handler: vi.fn(),
      metadata: { label: "weekly-report", priority: "high" },
    });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].metadata).toEqual({ label: "weekly-report", priority: "high" });

    // Verify metadata survives a new scheduler instance
    const scheduler2 = createPersistentScheduler({ dbPath });
    const jobs2 = await scheduler2.listJobs();
    expect(jobs2[0].metadata).toEqual({ label: "weekly-report", priority: "high" });
  });

  it("should initialize runCount to zero", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({ id: "fresh", cron: "* * * * *", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].runCount).toBe(0);
  });

  it("should handle jobs without metadata", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({ id: "no-meta", cron: "* * * * *", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].metadata).toBeUndefined();
  });

  it("should support interval type jobs", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({ id: "interval-job", interval: 30000, handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs[0].type).toBe("interval");
    expect(jobs[0].schedule).toBe("30000");
  });

  it("should replace job with same id via INSERT OR REPLACE", async () => {
    const scheduler = createPersistentScheduler({ dbPath });

    await scheduler.addJob({ id: "replace-me", cron: "0 8 * * *", handler: vi.fn() });
    await scheduler.addJob({ id: "replace-me", cron: "0 10 * * *", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 10 * * *");
  });

  it("should create database directory if it does not exist", async () => {
    const nestedPath = join(tmpDir, "nested", "deep", "scheduler.db");
    const scheduler = createPersistentScheduler({ dbPath: nestedPath });

    await scheduler.addJob({ id: "nested-job", cron: "* * * * *", handler: vi.fn() });

    const jobs = await scheduler.listJobs();
    expect(jobs).toHaveLength(1);
  });

  it("should stop interval timers on stop()", async () => {
    const scheduler = createPersistentScheduler({ dbPath });
    const handler = vi.fn();

    await scheduler.addJob({ id: "stoppable", interval: 1000, handler });
    await scheduler.start();

    vi.advanceTimersByTime(2500);
    const callsBefore = handler.mock.calls.length;

    await scheduler.stop();

    vi.advanceTimersByTime(5000);
    expect(handler.mock.calls.length).toBe(callsBefore);
  });
});
