import { createRoot } from "react-dom/client";
import { CompanyShortInfoBlock } from "./CompanyShortInfoBlock";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
createRoot(container).render(<CompanyShortInfoBlock />);
