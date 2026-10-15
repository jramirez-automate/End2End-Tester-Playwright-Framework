import { useEffect, useState } from "react";

function FadingImg({ src }: { src: string }) {
	const [visible, setVisible] = useState(false);
	return (
		<img
			className={`thumb__img thumb__img--incoming${visible ? " is-visible" : ""}`}
			src={src}
			alt=""
			onLoad={() => setVisible(true)}
		/>
	);
}

/**
 * A studio monitor. With a streamUrl and live=true it renders the MJPEG push
 * stream — realtime video of the worker's browser. Otherwise it polls the
 * latest JPEG every ~700ms while live (preloaded off-DOM so a missing frame
 * never flickers), crossfading each new frame in.
 */
export function WorkerThumb({
	url,
	streamUrl,
	caption,
	live,
	dim = false,
	intervalMs = 700,
}: {
	/** Thumb endpoint (no cache-bust query) or a static image URL; null = no signal. */
	url: string | null;
	/** MJPEG endpoint; used while live, falling back to polling if it errors. */
	streamUrl?: string;
	caption?: string;
	/** Poll with cache-busting while true; render once when false. */
	live: boolean;
	dim?: boolean;
	intervalMs?: number;
}) {
	const [layers, setLayers] = useState<{ base: string | null; top: string | null }>({ base: null, top: null });
	const [failed, setFailed] = useState(false);
	const [streamFailed, setStreamFailed] = useState(false);
	const [streamLoaded, setStreamLoaded] = useState(false);
	const streaming = live && Boolean(streamUrl) && !streamFailed;

	useEffect(() => {
		setStreamFailed(false);
		setStreamLoaded(false);
	}, [streamUrl, live]);

	useEffect(() => {
		if (streaming) return; // the MJPEG <img> updates itself — no polling
		setLayers({ base: null, top: null });
		setFailed(false);
		if (!url) return;
		let alive = true;
		if (!live) {
			// Static mode still preloads so a 404 shows "no signal", not a broken image.
			const img = new Image();
			img.onload = () => {
				if (alive) setLayers({ base: url, top: null });
			};
			img.onerror = () => {
				if (alive) setFailed(true);
			};
			img.src = url;
			return () => {
				alive = false;
			};
		}
		let inFlight = false;
		const tick = (): void => {
			if (inFlight) return;
			inFlight = true;
			const candidate = `${url}?t=${Date.now()}`;
			const img = new Image();
			img.onload = () => {
				inFlight = false;
				if (!alive) return;
				setFailed(false);
				setLayers((prev) => ({ base: prev.top ?? prev.base, top: candidate }));
			};
			img.onerror = () => {
				inFlight = false;
				if (alive) setFailed(true);
			};
			img.src = candidate;
		};
		tick();
		const timer = window.setInterval(tick, intervalMs);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, [url, live, intervalMs, streaming]);

	if (streaming && streamUrl) {
		return (
			<figure className={dim ? "opacity-60" : ""}>
				<div className="thumb__frame">
					<img
						className="thumb__img"
						src={streamUrl}
						alt=""
						onLoad={() => setStreamLoaded(true)}
						onError={() => setStreamFailed(true)}
					/>
					{!streamLoaded ? (
						<div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-putty">
							awaiting feed
						</div>
					) : null}
				</div>
				{caption ? (
					<figcaption className="mt-1 truncate font-mono text-[11px] text-putty">{caption}</figcaption>
				) : null}
			</figure>
		);
	}

	const blank = !layers.base && !layers.top;
	return (
		<figure className={dim ? "opacity-60" : ""}>
			<div className="thumb__frame">
				{layers.base ? <img className="thumb__img" src={layers.base} alt="" /> : null}
				{layers.top ? <FadingImg key={layers.top} src={layers.top} /> : null}
				{blank ? (
					<div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-putty">
						{failed ? "no signal" : "awaiting feed"}
					</div>
				) : null}
			</div>
			{caption ? (
				<figcaption className="mt-1 truncate font-mono text-[11px] text-putty">{caption}</figcaption>
			) : null}
		</figure>
	);
}
