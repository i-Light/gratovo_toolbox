import { strings } from "./strings";

/** A blank frame for now. Step 3c builds the real one from the prototype. */
export function App() {
  return (
    <main className="frame">
      <h1 className="frame-title">{strings.appName}</h1>
    </main>
  );
}
