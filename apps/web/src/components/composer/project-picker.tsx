"use client";

import type { ProjectSummary } from "@cheatcode/types";
import {
  type ProjectPickerVariant,
  useProjectPickerController,
} from "@/components/composer/project-picker-controller";
import {
  ProjectPickerDialogs,
  ProjectPickerMenu,
  ProjectPickerTrigger,
} from "@/components/composer/project-picker-parts";

/** Selects the existing project that receives the next prompt, or starts a new project. */
export function ProjectPicker({
  compact = false,
  onSelect,
  selectedProject,
  variant = "home",
}: {
  compact?: boolean | undefined;
  onSelect: (project: ProjectSummary | null) => void;
  selectedProject: ProjectSummary | null;
  variant?: ProjectPickerVariant | undefined;
}) {
  const controller = useProjectPickerController({ onSelect, selectedProject });
  return (
    <div className="relative min-w-0" ref={controller.meta.menuRef}>
      <ProjectPickerTrigger
        compact={compact}
        controller={controller}
        selectedProject={selectedProject}
        variant={variant}
      />
      {controller.state.isOpen ? <ProjectPickerMenu controller={controller} /> : null}
      <ProjectPickerDialogs controller={controller} />
    </div>
  );
}
