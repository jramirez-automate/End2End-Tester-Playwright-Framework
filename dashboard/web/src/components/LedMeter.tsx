import type { StepState } from "../../../shared/types";

function segClass(step: StepState, executing: boolean): string {
	switch (step.status) {
		case "done":
			return " meter__seg--ok";
		case "active":
			return executing ? " meter__seg--tally" : " meter__seg--feed";
		case "blocked":
			return " meter__seg--standby";
		case "skipped":
			return " meter__seg--skipped";
		default:
			return "";
	}
}

export function LedMeter({
	steps,
	executing = false,
	mini = false,
}: {
	steps: StepState[];
	executing?: boolean;
	mini?: boolean;
}) {
	// The meter is one segment per pipeline step (DESIGN.md) — step 0
	// (workspace provisioning) is carried by the rail and CUE eyebrow instead.
	const segments = steps.filter((s) => s.step >= 1);
	const done = segments.filter((s) => s.status === "done").length;
	return (
		<div
			className={mini ? "meter meter--mini" : "meter"}
			role="img"
			aria-label={`${done} of ${segments.length} steps done`}
		>
			{segments.map((s) => (
				<span key={s.step} className={`meter__seg${segClass(s, executing)}`} />
			))}
		</div>
	);
}
