import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { DigitalRain } from "./components/DigitalRain";
import { TopBar } from "./components/TopBar";
import { fetchDoctor } from "./state/api";
import { registerNavigator, useRunsStore } from "./state/runsStore";
import { useTheme } from "./theme";
import { AttentionView } from "./views/AttentionView";
import { BoardView } from "./views/BoardView";
import { BugsView } from "./views/BugsView";
import { CoverageView } from "./views/CoverageView";
import { HistoryRunView } from "./views/HistoryRunView";
import { MonitorWall } from "./views/MonitorWall";
import { NewRunForm } from "./views/NewRunForm";
import { OnboardingWizard } from "./views/OnboardingWizard";
import { RunView } from "./views/RunView";
import { SettingsView } from "./views/SettingsView";
import { TicketsView } from "./views/TicketsView";
import { TicketView } from "./views/TicketView";

export function App() {
	const navigate = useNavigate();
	const start = useRunsStore((s) => s.start);
	const theme = useTheme();

	useEffect(() => {
		registerNavigator((path) => navigate(path));
		start();
	}, [navigate, start]);

	// First-visit gate: a console that can't put runs on air opens on the
	// onboarding checklist instead of an empty wall.
	useEffect(() => {
		fetchDoctor()
			.then((report) => {
				if (!report.requiredOk) navigate("/onboarding");
			})
			.catch(() => {}); // older server without /api/doctor — nothing to gate
		// eslint-disable-next-line react-hooks/exhaustive-deps -- boot-only check
	}, []);

	return (
		<div className="flex h-dvh flex-col">
			{theme === "matrix" ? <DigitalRain /> : null}
			<TopBar />
			<main className="min-h-0 flex-1">
				<Routes>
					<Route path="/" element={<AttentionView />} />
					<Route path="/wall" element={<MonitorWall />} />
					<Route path="/runs/:id" element={<RunView />} />
					<Route path="/new" element={<NewRunForm />} />
					<Route path="/settings" element={<SettingsView />} />
					<Route path="/onboarding" element={<OnboardingWizard />} />
					<Route path="/tickets" element={<TicketsView />} />
					<Route path="/tickets/:key" element={<TicketView />} />
					<Route path="/board" element={<BoardView />} />
					<Route path="/bugs" element={<BugsView />} />
					<Route path="/coverage" element={<CoverageView />} />
					<Route path="/results" element={<Navigate to="/coverage#health" replace />} />
					<Route path="/results/:id" element={<HistoryRunView />} />
				</Routes>
			</main>
		</div>
	);
}
