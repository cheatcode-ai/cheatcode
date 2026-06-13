import type { TaskStatus } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";

type AgentRunTaskId = "prepare-sandbox" | "run-agent" | "stream-results";

const RUN_TASKS: ReadonlyArray<{ id: AgentRunTaskId; title: string }> = [
  { id: "prepare-sandbox", title: "Prepare Blaxel sandbox" },
  { id: "run-agent", title: "Run agent tools" },
  { id: "stream-results", title: "Stream workspace result" },
];

export function runPlanChunk(): UIMessageChunk {
  return {
    type: "data-plan",
    data: {
      v: 1,
      parallelGroups: [[0], [1], [2]],
      tasks: RUN_TASKS.map((task, index) => ({
        id: task.id,
        status: index === 0 ? "running" : "pending",
        title: task.title,
      })),
    },
  };
}

export function runTaskStatusChunk(
  taskId: AgentRunTaskId,
  status: TaskStatus,
  error?: string,
): UIMessageChunk {
  return {
    type: "data-task-status",
    data: {
      v: 1,
      taskId,
      status,
      ...(error ? { error } : {}),
    },
  };
}
