import { Link, NavLink } from "react-router-dom";
import { ACTIVE_STATES } from "../../../shared/types";
import { useRunsStore } from "../state/runsStore";
import { GoLivePill } from "./GoLivePill";
import { RundownMenu } from "./RundownMenu";
import { TabStrip } from "./TabStrip";

export function TopBar() {
	const runs = useRunsStore((s) => s.runs);
	const active = Object.values(runs).filter((r) => ACTIVE_STATES.includes(r.state)).length;

	return (
		<header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-ink-1 px-4">
			<Link to="/" className="wordmark eyebrow text-[13px] font-bold whitespace-nowrap text-bone">
				E2E Control
			</Link>
			<nav className="flex items-center gap-1" aria-label="Views">
				<TopNavLink to="/" end>
					Attention
				</TopNavLink>
				<TopNavLink to="/tickets">Tickets</TopNavLink>
				<TopNavLink to="/board">Board</TopNavLink>
				<TopNavLink to="/bugs">Bugs</TopNavLink>
				<TopNavLink to="/coverage">Coverage</TopNavLink>
			</nav>
			<RundownMenu />
			<TabStrip />
			<GoLivePill />
			<LockReadout />
			<span className="font-mono text-xs whitespace-nowrap text-putty" title="Runs on air or waiting on you">
				{active} live
			</span>
		</header>
	);
}

/** Read-only tracker views — the active one reads bone on ink-2, the rest putty. */
function TopNavLink({ to, end, children }: { to: string; end?: boolean; children: string }) {
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				`eyebrow rounded px-2 py-1 transition-colors ${isActive ? "bg-ink-2 text-bone" : "text-putty hover:text-bone"}`
			}
		>
			{children}
		</NavLink>
	);
}

/**
 * Env-lock occupancy readout — "dev 1/2 · staging 0/1". A saturated env's
 * fraction goes standby; queued waiters add a HOLD chip. Mono per DESIGN.md
 * (anything live or countable), signal color on the state fragment only.
 */
function LockReadout() {
	const locks = useRunsStore((s) => s.locks);
	if (!locks) return null;
	const envs = Object.keys(locks.caps);
	if (envs.length === 0) return null;
	return (
		<span
			className="hidden items-center gap-2 font-mono text-xs whitespace-nowrap text-putty md:flex"
			title="Env locks — concurrent Playwright executions per environment"
		>
			{envs.map((env) => {
				const cap = locks.caps[env] ?? 0;
				const held = locks.held.filter((lease) => lease.env === env).length;
				return (
					<span key={env}>
						{env}{" "}
						<span className={held >= cap ? "text-standby" : ""}>
							{held}/{cap}
						</span>
					</span>
				);
			})}
			{locks.waiting > 0 ? (
				<span className="eyebrow text-standby" title="Runs holding at the lock for a free slot">
					HOLD {locks.waiting}
				</span>
			) : null}
		</span>
	);
}
