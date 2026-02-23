import type { Tool, ToolContext, ToolResult } from "clawkit:types";

export interface HardwareToolConfig {}

export default function createHardwareTool(_config: HardwareToolConfig): Tool {
  return {
    name: "hardware",
    description:
      "Get system hardware information: CPU, memory, disk usage, and network interfaces.",
    parameters: {
      type: "object",
      properties: {
        info: {
          type: "string",
          enum: ["cpu", "memory", "disk", "network", "all"],
          description: "Type of hardware information to retrieve",
        },
      },
      required: ["info"],
    },

    async execute(
      args: { info: "cpu" | "memory" | "disk" | "network" | "all" },
      _context: ToolContext,
    ): Promise<ToolResult> {
      try {
        const si = await import("systeminformation");
        const sections: string[] = [];
        const toGB = (bytes: number) => (bytes / 1073741824).toFixed(1);

        if (args.info === "cpu" || args.info === "all") {
          const cpu = await si.cpu();
          const load = await si.currentLoad();
          sections.push(
            `## CPU\nModel: ${cpu.manufacturer} ${cpu.brand}\n` +
              `Cores: ${cpu.physicalCores} physical, ${cpu.cores} logical\n` +
              `Speed: ${cpu.speed} GHz (max ${cpu.speedMax} GHz)\n` +
              `Current Load: ${load.currentLoad.toFixed(1)}%`,
          );
        }

        if (args.info === "memory" || args.info === "all") {
          const mem = await si.mem();
          sections.push(
            `## Memory\nTotal: ${toGB(mem.total)} GB\n` +
              `Used: ${toGB(mem.used)} GB (${((mem.used / mem.total) * 100).toFixed(1)}%)\n` +
              `Free: ${toGB(mem.free)} GB`,
          );
        }

        if (args.info === "disk" || args.info === "all") {
          const disks = await si.fsSize();
          const diskLines = disks.map(
            (d) => `  ${d.mount}: ${toGB(d.used)}/${toGB(d.size)} GB (${d.use?.toFixed(1) ?? "?"}% used)`,
          );
          sections.push(`## Disk\n${diskLines.join("\n")}`);
        }

        if (args.info === "network" || args.info === "all") {
          const nets = await si.networkInterfaces();
          const netArray = Array.isArray(nets) ? nets : [nets];
          const netLines = netArray
            .filter((n: any) => n.ip4 && !n.internal)
            .map((n: any) => `  ${n.iface}: ${n.ip4} (${n.type ?? "unknown"}, speed: ${n.speed ?? "?"}Mbps)`);
          sections.push(
            `## Network\n${netLines.length > 0 ? netLines.join("\n") : "  No active external interfaces"}`,
          );
        }

        return {
          output: sections.join("\n\n"),
          metadata: { info: args.info },
        };
      } catch (err: any) {
        return { output: "", error: err.message };
      }
    },
  };
}
