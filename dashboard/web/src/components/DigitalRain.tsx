import { useEffect, useRef } from "react";

/** Half-width katakana + digits + a few suite glyphs, as the falling code. */
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789E2E<>=*+-:";
const CELL_PX = 16;
/** ~14fps is enough to read as rain and keeps an idle tab cheap. */
const FRAME_MS = 70;

function cssColor(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
}

/**
 * Matrix theme backdrop: a fixed canvas behind the app, low opacity, never
 * interactive. Pauses while the tab is hidden; with prefers-reduced-motion it
 * paints one still frame instead of animating.
 */
export function DigitalRain() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const trail = cssColor("--color-ok", "#00ff41");
		const lead = cssColor("--color-tally", "#d8ffde");
		const fade = cssColor("--rain-fade", "rgba(0, 4, 0, 0.12)");
		let drops: number[] = [];
		let timer = 0;

		const resize = (): void => {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = Math.floor(window.innerWidth * dpr);
			canvas.height = Math.floor(window.innerHeight * dpr);
			canvas.style.width = `${window.innerWidth}px`;
			canvas.style.height = `${window.innerHeight}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			const columns = Math.ceil(window.innerWidth / CELL_PX);
			const rows = Math.ceil(window.innerHeight / CELL_PX);
			// Stagger starts so the screen isn't one falling wall.
			drops = Array.from({ length: columns }, () => Math.floor(Math.random() * -rows));
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
		};

		const glyph = (): string => GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "0";

		const draw = (): void => {
			const rows = Math.ceil(window.innerHeight / CELL_PX);
			ctx.fillStyle = fade;
			ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
			ctx.font = `${CELL_PX - 2}px "Share Tech Mono", "IBM Plex Mono", monospace`;
			for (let i = 0; i < drops.length; i++) {
				const y = drops[i] ?? 0;
				const x = i * CELL_PX;
				if (y >= 0) {
					// The lead glyph burns white-hot; the one behind it re-greens the trail.
					ctx.fillStyle = trail;
					ctx.fillText(glyph(), x, (y - 1) * CELL_PX);
					ctx.fillStyle = lead;
					ctx.fillText(glyph(), x, y * CELL_PX);
				}
				drops[i] = y > rows && Math.random() > 0.975 ? 0 : y + 1;
			}
		};

		const paintStill = (): void => {
			// Reduced motion: advance silently to a full-looking screen, show that once.
			for (let n = 0; n < 60; n++) draw();
		};

		const loop = (): void => {
			draw();
			timer = window.setTimeout(loop, FRAME_MS);
		};

		const start = (): void => {
			window.clearTimeout(timer);
			if (reduceMotion) paintStill();
			else if (!document.hidden) loop();
		};

		const onVisibility = (): void => {
			if (document.hidden) window.clearTimeout(timer);
			else start();
		};

		const onResize = (): void => {
			resize();
			start();
		};

		resize();
		start();
		window.addEventListener("resize", onResize);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("resize", onResize);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	return <canvas ref={canvasRef} className="rain" aria-hidden />;
}
