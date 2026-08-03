import { createRoot } from "react-dom/client";
import { CompanyPeopleBlock } from "./CompanyPeopleBlock";
import "./variables.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
createRoot(container).render(<CompanyPeopleBlock />);
