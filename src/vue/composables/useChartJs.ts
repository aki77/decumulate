import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";
import Annotation from "chartjs-plugin-annotation";

let registered = false;

export function ensureChartRegistered(): void {
  if (registered) return;
  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Filler,
    Legend,
    Tooltip,
    Annotation,
  );
  registered = true;
}
