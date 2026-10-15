/**
 * Inline evidence: screenshots open full size in a new tab; screencasts play in
 * place with their same-named screenshot as poster (nothing downloads until
 * Play). Traces/HAR/JSON render as plain download links.
 */
export function EvidenceMedia({ names, url, size = "sm" }: { names: string[]; url: (name: string) => string; size?: "sm" | "lg" }) {
	if (names.length === 0) return null;
	const width = size === "lg" ? "w-80" : "w-40";
	const posterFor = (video: string): string | undefined => {
		const png = video.replace(/\.webm$/i, ".png");
		return names.includes(png) ? url(png) : undefined;
	};
	// A png that is some video's poster is shown through the video, not twice.
	const posters = new Set(names.filter((n) => /\.webm$/i.test(n)).map((n) => n.replace(/\.webm$/i, ".png")));

	return (
		<div className="flex flex-wrap gap-2">
			{names.map((name) => {
				if (/\.webm$/i.test(name)) {
					return (
						<video
							key={name}
							className={`${width} rounded border border-line bg-ink-0`}
							src={url(name)}
							poster={posterFor(name)}
							preload="none"
							controls
							title={name}
						/>
					);
				}
				if (/\.(png|jpe?g)$/i.test(name)) {
					if (posters.has(name)) return null;
					return (
						<a key={name} href={url(name)} target="_blank" rel="noopener noreferrer" title={name}>
							<img
								className={`${width} rounded border border-line bg-ink-0 object-cover`}
								src={url(name)}
								alt={name}
								loading="lazy"
							/>
						</a>
					);
				}
				return (
					<a
						key={name}
						className="link font-mono text-xs break-all text-feed"
						href={url(name)}
						target="_blank"
						rel="noopener noreferrer"
					>
						{name}
					</a>
				);
			})}
		</div>
	);
}
