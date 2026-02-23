import { describe, it, expect, vi } from "vitest";
import createCronTool from "../../registry/tools/cron/index.js";

describe("tool-cron", () => {
  const baseContext = { workspaceDir: ".", sessionId: "test-session" };

  it("should create a tool with correct interface", () => {
    const tool = createCronTool({});
    expect(tool.name).toBe("cron");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.required).toContain("action");
    expect(tool.parameters.properties.action.enum).toEqual(["create", "list", "delete"]);
    expect(tool.parameters.properties).toHaveProperty("schedule");
    expect(tool.parameters.properties).toHaveProperty("handler");
    expect(tool.parameters.properties).toHaveProperty("jobId");
  });

  it("should create a scheduled job", async () => {
    const tool = createCronTool({});
    const result = await tool.execute(
      { action: "create", schedule: "*/5 * * * *", handler: "Check for new emails" },
      baseContext,
    );

    expect(result.output).toContain("Created job");
    expect(result.output).toContain("Check for new emails");
    expect(result.output).toContain("*/5 * * * *");
    expect(result.metadata?.jobId).toBeTruthy();
  });

  it("should list jobs", async () => {
    const tool = createCronTool({});

    // Create a job first
    await tool.execute(
      { action: "create", schedule: "0 9 * * *", handler: "Morning report" },
      baseContext,
    );

    const result = await tool.execute({ action: "list" }, baseContext);
    expect(result.output).toContain("Morning report");
    expect(result.output).toContain("0 9 * * *");
  });

  it("should delete a job", async () => {
    const tool = createCronTool({});

    // Create a job
    const createResult = await tool.execute(
      { action: "create", schedule: "0 0 * * *", handler: "Midnight cleanup" },
      baseContext,
    );
    const jobId = createResult.metadata?.jobId as string;

    // Delete it
    const deleteResult = await tool.execute({ action: "delete", jobId }, baseContext);
    expect(deleteResult.output).toContain("Deleted");

    // Verify it is gone
    const listResult = await tool.execute({ action: "list" }, baseContext);
    expect(listResult.output).not.toContain("Midnight cleanup");
  });

  it("should error when creating without schedule", async () => {
    const tool = createCronTool({});
    const result = await tool.execute(
      { action: "create", handler: "task" },
      baseContext,
    );
    expect(result.error).toContain("schedule is required");
  });

  it("should error when creating without handler", async () => {
    const tool = createCronTool({});
    const result = await tool.execute(
      { action: "create", schedule: "* * * * *" },
      baseContext,
    );
    expect(result.error).toContain("handler is required");
  });

  it("should error when deleting without jobId", async () => {
    const tool = createCronTool({});
    const result = await tool.execute({ action: "delete" }, baseContext);
    expect(result.error).toContain("jobId is required");
  });

  it("should error when deleting nonexistent job", async () => {
    const tool = createCronTool({});
    const result = await tool.execute(
      { action: "delete", jobId: "job_999" },
      baseContext,
    );
    expect(result.error).toContain("not found");
  });

  it("should notify scheduler via sendMessage on create", async () => {
    const sendMessage = vi.fn().mockResolvedValue("registered");

    const tool = createCronTool({});
    await tool.execute(
      { action: "create", schedule: "0 * * * *", handler: "hourly check" },
      { ...baseContext, sendMessage },
    );

    expect(sendMessage).toHaveBeenCalledWith("scheduler", expect.objectContaining({
      action: "register",
      schedule: "0 * * * *",
      handler: "hourly check",
    }));
  });

  it("should handle unknown action", async () => {
    const tool = createCronTool({});
    const result = await tool.execute({ action: "pause" } as any, baseContext);
    expect(result.error).toContain("Unknown action");
  });
});
