import { strings } from "./strings";

// The frame arrives in step 3c. For now the window is blank apart from its name.
export function App() {
  return (
    <main className="app-shell">
      <h1>{strings.appName}</h1>
    </main>
  );
}
