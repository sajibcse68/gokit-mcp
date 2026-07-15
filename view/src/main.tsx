import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
createRoot(container).render(<Dashboard />);
