import type { ReactNode } from "react";

/** The standard bordered section with an eyebrow title. */
export function Panel({ title, children, id }: { title: ReactNode; children: ReactNode; id?: string }) {
	return (
		<section id={id} className="rounded-lg border border-line bg-ink-1 p-4">
			<h2 className="eyebrow mb-3 text-bone">{title}</h2>
			{children}
		</section>
	);
}
